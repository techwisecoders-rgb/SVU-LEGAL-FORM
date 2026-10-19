import 'dotenv/config';
import express, {Request, Response, NextFunction, RequestHandler} from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import nodemailer from 'nodemailer';
import {Prisma, PrismaClient} from './generated/prisma/client.js';
import {PrismaPg} from '@prisma/adapter-pg';
import {createReadStream} from 'node:fs';
import {execFile as execFileCb} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir, readFile, unlink, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {z} from 'zod';
import {hashPassword, hmacSha256, randomToken, safeEqual, tokenHash, verifyPassword} from './security.js';

const app = express();
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must be configured before starting the API.');
const prisma = new PrismaClient({adapter: new PrismaPg({connectionString: process.env.DATABASE_URL})});
const execFile = promisify(execFileCb);
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet({crossOriginResourcePolicy: {policy: 'same-site'}}));

const DEPLOYMENT_ORIGIN = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || DEPLOYMENT_ORIGIN).replace(/\/$/, '');
// In the one-project deployment, verification links use the same domain as the website.
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL || SITE_ORIGIN).replace(/\/$/, '');
const COOKIE_NAME = 'svu_session';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_TTL_MS = 30 * 60 * 1000;
const UPLOAD_DIR = path.resolve(process.env.PRIVATE_UPLOAD_DIR || path.join(process.cwd(), '.private-uploads'));

app.use(cors({
  origin(origin, callback) {
    const vercelOrigin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
    if (!origin || origin === SITE_ORIGIN || (vercelOrigin && origin === vercelOrigin)) return callback(null, true);
    return callback(new Error('Origin not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Idempotency-Key'],
}));

// Cookie-authenticated writes accept requests only from the configured first-party website.
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.path !== '/api/payments/webhook') {
    const origin = req.get('origin');
    const requestHost = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim().toLowerCase();
    const requestProto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim().toLowerCase();
    const requestOrigin = requestHost ? `${requestProto}://${requestHost}` : '';
    const vercelOrigin = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
    if (!origin || (origin.replace(/\/$/, '') !== SITE_ORIGIN && origin.replace(/\/$/, '') !== vercelOrigin && origin.replace(/\/$/, '') !== requestOrigin)) return res.status(403).json({message: 'Request origin was not allowed.'});
  }
  next();
});

// Basic per-IP throttle. For multi-instance production deployment, replace this in-memory limiter
// with a shared gateway/WAF or a shared rate-limit store.
const rateBuckets = new Map<string, {count: number; start: number}>();
app.use((req, res, next) => {
  const now = Date.now();
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const previous = rateBuckets.get(key);
  if (!previous || now - previous.start >= 60_000) rateBuckets.set(key, {count: 1, start: now});
  else {
    previous.count += 1;
    if (previous.count > 100) return res.status(429).json({message: 'Too many requests. Please wait a minute and try again.'});
  }
  next();
});

function asyncRoute(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => { void fn(req, res, next).catch(next); };
}
class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function validate(schema: z.ZodTypeAny, handler: (req: Request, res: Response, data: any) => Promise<unknown>): RequestHandler {
  return asyncRoute(async (req, res) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({message: 'Please check the submitted fields.', errors: parsed.error.flatten()});
    return handler(req, res, parsed.data);
  });
}
interface AuthUser {id: string; name: string; email: string; role: string; isSuspended: boolean; emailVerifiedAt: Date | null}
interface AuthRequest extends Request {authUser?: AuthUser; sessionId?: string}
function cookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of (req.headers.cookie || '').split(';')) {
    const index = item.indexOf('=');
    if (index > 0) out[item.slice(0, index).trim()] = decodeURIComponent(item.slice(index + 1).trim());
  }
  return out;
}
function setSessionCookie(res: Response, token: string) {
  const sameSite = (process.env.SESSION_COOKIE_SAMESITE || 'lax').toLowerCase() as 'lax' | 'strict' | 'none';
  res.cookie(COOKIE_NAME, token, {httpOnly: true, secure: process.env.NODE_ENV === 'production' || sameSite === 'none', sameSite, path: '/', maxAge: SESSION_TTL_MS});
}
function clearSessionCookie(res: Response) {
  const sameSite = (process.env.SESSION_COOKIE_SAMESITE || 'lax').toLowerCase() as 'lax' | 'strict' | 'none';
  res.clearCookie(COOKIE_NAME, {httpOnly: true, secure: process.env.NODE_ENV === 'production' || sameSite === 'none', sameSite, path: '/'});
}
const optionalAuth: RequestHandler = async (req, res, next) => {
  try {
    const token = cookies(req)[COOKIE_NAME];
    if (!token) return next();
    const session = await prisma.session.findFirst({where: {tokenHash: tokenHash(token), revokedAt: null, expiresAt: {gt: new Date()}}, include: {user: true}});
    if (!session || session.user.isSuspended) { clearSessionCookie(res); return next(); }
    (req as AuthRequest).authUser = {id: session.user.id, name: session.user.name, email: session.user.email, role: session.user.role, isSuspended: session.user.isSuspended, emailVerifiedAt: session.user.emailVerifiedAt};
    (req as AuthRequest).sessionId = session.id;
    next();
  } catch (error) { next(error); }
};
const requireAuth: RequestHandler = (req, res, next) => {
  void optionalAuth(req, res, (error?: unknown) => {
    if (error) return next(error);
    if (!(req as AuthRequest).authUser) return res.status(401).json({message: 'Please sign in to continue.'});
    next();
  });
};
const requireVerified: RequestHandler = (req, res, next) => {
  const user = (req as AuthRequest).authUser;
  if (!user) return res.status(401).json({message: 'Please sign in to continue.'});
  if (!user.emailVerifiedAt) return res.status(403).json({message: 'Verify your email address before using this feature.'});
  next();
};
function requireRole(...roles: string[]): RequestHandler {
  return (req, res, next) => {
    const user = (req as AuthRequest).authUser;
    if (!user) return res.status(401).json({message: 'Please sign in to continue.'});
    if (!roles.includes(user.role)) return res.status(403).json({message: 'You do not have permission to access this resource.'});
    next();
  };
}
function currentUser(req: Request): AuthUser { return (req as AuthRequest).authUser!; }
function ref(prefix: string): string { return `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`; }
function cleanFilename(name: string): string { return path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 150) || 'document'; }
function safeText(value: unknown, max = 160): string { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }
function recordIp(req: Request): string | null { return (req.ip || '').slice(0, 80) || null; }
async function audit(req: Request, actorId: string | null, action: string, targetType: string, targetId?: string, metadata?: Prisma.InputJsonValue) {
  try { await prisma.auditLog.create({data: {actorId, action, targetType, targetId, ipAddress: recordIp(req), metadata}}); }
  catch (error) { console.error('Audit log write failed:', error instanceof Error ? error.message : 'unknown'); }
}

async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!process.env.SMTP_HOST) {
    if (process.env.NODE_ENV !== 'production') console.info(`[development email] To: ${to}\nSubject: ${subject}\n${text}`);
    return false;
  }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: process.env.SMTP_USER ? {user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || ''} : undefined,
  });
  await transport.sendMail({from: process.env.MAIL_FROM || 'SVU Developers <no-reply@example.com>', to, subject, text});
  return true;
}
async function notifySafely(to: string, subject: string, text: string) {
  try { await sendMail(to, subject, text); }
  catch (error) { console.error('Notification delivery failed:', error instanceof Error ? error.message : 'unknown'); }
}
async function createOneTimeToken(userId: string, purpose: string, ttl = TOKEN_TTL_MS) {
  const token = randomToken();
  await prisma.verificationToken.create({data: {userId, purpose, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + ttl)}});
  return token;
}
async function issueSession(user: {id: string}) {
  const token = randomToken();
  await prisma.session.create({data: {userId: user.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + SESSION_TTL_MS)}});
  return token;
}

app.get(['/health', '/api/health'], (_req, res) => res.json({status: 'ok', service: 'svu-api', timestamp: new Date().toISOString()}));

// Razorpay sends a signed raw JSON body. This route must be registered before express.json().
app.post('/api/payments/webhook', express.raw({type: 'application/json', limit: '1mb'}), asyncRoute(async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(503, 'Payment webhook secret is not configured.');
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  const supplied = req.get('x-razorpay-signature') || '';
  const expected = hmacSha256(secret, raw);
  if (!supplied || !safeEqual(supplied, expected)) throw new HttpError(401, 'Invalid payment webhook signature.');
  let payload: any;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'Invalid webhook payload.'); }
  const eventType = safeText(payload.event, 100) || 'unknown';
  const eventId = safeText(req.get('x-razorpay-event-id'), 200) || createHash('sha256').update(raw).digest('hex');
  let event = await prisma.paymentWebhookEvent.findUnique({where: {eventId}});
  if (event?.processedAt) return res.json({received: true, duplicate: true});
  if (!event) {
    try { event = await prisma.paymentWebhookEvent.create({data: {eventId, eventType, payload}}); }
    catch (error) {
      if ((error as any)?.code === 'P2002') return res.json({received: true, duplicate: true});
      throw error;
    }
  }

  const paymentEntity = payload?.payload?.payment?.entity;
  const refundEntity = payload?.payload?.refund?.entity;
  if (['payment.captured', 'order.paid'].includes(eventType) && paymentEntity?.order_id) {
    const payment = await prisma.payment.findUnique({where: {gatewayOrderId: paymentEntity.order_id}});
    if (!payment || paymentEntity.amount !== payment.amountPaise || paymentEntity.currency !== payment.currency || (paymentEntity.id && payment.gatewayPaymentId && payment.gatewayPaymentId !== paymentEntity.id)) throw new HttpError(503, 'Captured payment does not match a known order yet; webhook should be retried.');
    await markPaymentCaptured(payment.id, paymentEntity.id || payment.gatewayPaymentId || '');
  } else if (eventType === 'payment.failed' && paymentEntity?.order_id) {
    await prisma.payment.updateMany({where: {gatewayOrderId: paymentEntity.order_id, status: {not: 'CAPTURED'}}, data: {status: 'FAILED', failureReason: safeText(paymentEntity.error_description || paymentEntity.error_reason || 'Payment failed', 500), activeTargetKey: null}});
  } else if (eventType.startsWith('refund.') && refundEntity?.id) {
    const matched = await prisma.refund.findUnique({where: {gatewayRefundId: refundEntity.id}, include: {payment: true}});
    if (matched) {
      const nextStatus = eventType === 'refund.processed' ? 'PROCESSED' : eventType === 'refund.failed' ? 'FAILED' : 'PENDING';
      await prisma.refund.update({where: {id: matched.id}, data: {status: nextStatus}});
      if (nextStatus === 'PROCESSED') {
        const total = await prisma.refund.aggregate({where: {paymentId: matched.paymentId, status: 'PROCESSED'}, _sum: {amountPaise: true}});
        if ((total._sum.amountPaise || 0) >= matched.payment.amountPaise) {
          if (matched.payment.bookingId) await prisma.bookingRequest.update({where: {id: matched.payment.bookingId}, data: {paymentStatus: 'REFUNDED', status: 'CANCELLED'}});
          if (matched.payment.disputeCaseId) await prisma.disputeCase.update({where: {id: matched.payment.disputeCaseId}, data: {paymentStatus: 'REFUNDED'}});
        }
      }
    } else { throw new HttpError(503, 'Refund event does not match a saved refund yet; retry delivery.'); }
  }
  await prisma.paymentWebhookEvent.update({where: {eventId}, data: {processedAt: new Date()}});
  return res.json({received: true});
}));

app.use(express.json({limit: '300kb'}));

// In a single Next.js/Vercel deployment there is no long-running Express app.listen callback.
// Initialize the private local directory and optional first administrator once per warm instance.
let runtimeInitialization: Promise<void> | null = null;
app.use((_req, _res, next) => {
  if (!runtimeInitialization) {
    runtimeInitialization = (async () => {
      await mkdir(UPLOAD_DIR, {recursive: true, mode: 0o700});
      await bootstrapAdministrator();
    })().catch((error) => {
      runtimeInitialization = null;
      throw error;
    });
  }
  void runtimeInitialization.then(() => next()).catch(next);
});

const authRateBuckets = new Map<string, {count: number; start: number}>();
const authThrottle: RequestHandler = (req, res, next) => {
  const key = `${req.ip || 'unknown'}:${req.path}`; const now = Date.now(); const current = authRateBuckets.get(key);
  if (!current || now - current.start >= 15 * 60_000) authRateBuckets.set(key, {count: 1, start: now});
  else { current.count += 1; if (current.count > 12) return res.status(429).json({message: 'Too many account-security attempts. Try again in 15 minutes.'}); }
  next();
};

app.get('/api/auth/me', optionalAuth, (req, res) => {
  const user = (req as AuthRequest).authUser;
  return res.json({user: user ? {id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: !!user.emailVerifiedAt} : null});
});

app.post('/api/auth/register', authThrottle, validate(z.object({name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), password: z.string().min(12).max(128)}), async (_req, res, data) => {
  if (!/[a-z]/.test(data.password) || !/[A-Z]/.test(data.password) || !/[0-9]/.test(data.password) || !/[^A-Za-z0-9]/.test(data.password)) return res.status(400).json({message: 'Use at least 12 characters including upper- and lowercase letters, a number and a symbol.'});
  const existing = await prisma.user.findUnique({where: {email: data.email}});
  if (existing) return res.status(409).json({message: 'An account with this email already exists. Sign in or use password recovery.'});
  const user = await prisma.user.create({data: {name: data.name, email: data.email, passwordHash: await hashPassword(data.password)}});
  const token = await createOneTimeToken(user.id, 'EMAIL_VERIFY', 24 * 60 * 60 * 1000);
  const link = `${API_ORIGIN}/api/auth/verify?token=${encodeURIComponent(token)}`;
  try { await sendMail(user.email, 'Verify your SVU Developers account', `Hello ${user.name},\n\nVerify your email address using this one-time link (expires in 24 hours):\n${link}\n\nIf you did not create this account, you can ignore this message.`); } catch (error) { console.error('Verification email could not be sent:', error instanceof Error ? error.message : 'unknown'); }
  const session = await issueSession(user);
  setSessionCookie(res, session);
  return res.status(201).json({user: {id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: false}, message: 'Account created. Check your email for a verification link.', developmentVerificationLink: process.env.NODE_ENV === 'production' ? undefined : (process.env.SMTP_HOST ? undefined : link)});
}));

app.get('/api/auth/verify', asyncRoute(async (req, res) => {
  const token = safeText(req.query.token, 300);
  if (!token) return res.redirect(`${SITE_ORIGIN}/login?verified=0`);
  const row = await prisma.verificationToken.findFirst({where: {tokenHash: tokenHash(token), purpose: 'EMAIL_VERIFY', usedAt: null, expiresAt: {gt: new Date()}}, include: {user: true}});
  if (!row) return res.redirect(`${SITE_ORIGIN}/login?verified=0`);
  await prisma.$transaction([
    prisma.user.update({where: {id: row.userId}, data: {emailVerifiedAt: new Date()}}),
    prisma.verificationToken.update({where: {id: row.id}, data: {usedAt: new Date()}}),
  ]);
  return res.redirect(`${SITE_ORIGIN}/login?verified=1`);
}));

app.post('/api/auth/resend-verification', authThrottle, requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req);
  if (user.emailVerifiedAt) return res.json({message: 'This email address is already verified.'});
  const token = await createOneTimeToken(user.id, 'EMAIL_VERIFY', 24 * 60 * 60 * 1000);
  const link = `${API_ORIGIN}/api/auth/verify?token=${encodeURIComponent(token)}`;
  try { await sendMail(user.email, 'Verify your SVU Developers account', `Use this one-time link within 24 hours to verify your email:\n${link}`); } catch (error) { console.error('Verification email could not be sent:', error instanceof Error ? error.message : 'unknown'); }
  return res.json({message: process.env.NODE_ENV === 'production' ? 'If email delivery is configured, a new verification link has been sent.' : 'Verification link prepared.', developmentVerificationLink: process.env.NODE_ENV === 'production' || process.env.SMTP_HOST ? undefined : link});
}));

app.post('/api/auth/login', authThrottle, validate(z.object({email: z.string().trim().email().max(254).transform(v => v.toLowerCase()), password: z.string().min(1).max(128)}), async (_req, res, data) => {
  const user = await prisma.user.findUnique({where: {email: data.email}});
  if (!user || user.isSuspended || !(await verifyPassword(data.password, user.passwordHash))) return res.status(401).json({message: 'Email or password is incorrect.'});
  const token = await issueSession(user);
  setSessionCookie(res, token);
  return res.json({user: {id: user.id, name: user.name, email: user.email, role: user.role, emailVerified: !!user.emailVerifiedAt}, message: 'Signed in.'});
}));

app.patch('/api/auth/profile', requireAuth, validate(z.object({name: z.string().trim().min(2).max(120).optional(), currentPassword: z.string().max(128).optional(), newPassword: z.string().min(12).max(128).optional()}), async (req, res, data) => {
  const user = currentUser(req);
  const current = await prisma.user.findUnique({where: {id: user.id}});
  if (!current) return res.status(404).json({message: 'Account not found.'});
  const update: Prisma.UserUpdateInput = {};
  if (data.name) update.name = data.name;
  if (data.newPassword) {
    if (!data.currentPassword || !(await verifyPassword(data.currentPassword, current.passwordHash))) return res.status(400).json({message: 'Current password is incorrect.'});
    if (!/[a-z]/.test(data.newPassword) || !/[A-Z]/.test(data.newPassword) || !/[0-9]/.test(data.newPassword) || !/[^A-Za-z0-9]/.test(data.newPassword)) return res.status(400).json({message: 'Use upper- and lowercase letters, a number and a symbol.'});
    update.passwordHash = await hashPassword(data.newPassword);
  }
  if (!Object.keys(update).length) return res.status(400).json({message: 'No account changes were supplied.'});
  const saved = await prisma.user.update({where: {id: user.id}, data: update, select: {id: true, name: true, email: true, role: true, emailVerifiedAt: true}});
  if (data.newPassword) await prisma.session.updateMany({where: {userId: user.id, revokedAt: null, ...( (req as AuthRequest).sessionId ? {id: {not: (req as AuthRequest).sessionId}} : {})}, data: {revokedAt: new Date()}});
  await audit(req, user.id, 'ACCOUNT_PROFILE_UPDATED', 'User', user.id);
  return res.json({user: {...saved, emailVerified: !!saved.emailVerifiedAt}, message: 'Account settings updated.'});
}));

app.post('/api/auth/logout', optionalAuth, asyncRoute(async (req, res) => {
  const authReq = req as AuthRequest;
  if (authReq.sessionId) await prisma.session.update({where: {id: authReq.sessionId}, data: {revokedAt: new Date()}});
  clearSessionCookie(res);
  return res.json({message: 'Signed out.'});
}));

app.post('/api/auth/forgot-password', authThrottle, validate(z.object({email: z.string().trim().email().max(254).transform(v => v.toLowerCase())}), async (_req, res, data) => {
  const generic = {message: 'If an account exists for that email, password-reset instructions have been sent.'};
  const user = await prisma.user.findUnique({where: {email: data.email}});
  if (user && !user.isSuspended) {
    const token = await createOneTimeToken(user.id, 'PASSWORD_RESET');
    const link = `${SITE_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`;
    try { await sendMail(user.email, 'Reset your SVU Developers password', `A password reset was requested for your account. This link expires in 30 minutes and can be used once:\n${link}\n\nIf you did not request this, ignore this email.`); } catch (error) { console.error('Password reset email could not be sent:', error instanceof Error ? error.message : 'unknown'); }
    if (process.env.NODE_ENV !== 'production' && !process.env.SMTP_HOST) console.info(`[development reset link] ${link}`);
  }
  return res.json(generic);
}));

app.post('/api/auth/reset-password', authThrottle, validate(z.object({token: z.string().min(20).max(300), password: z.string().min(12).max(128)}), async (_req, res, data) => {
  if (!/[a-z]/.test(data.password) || !/[A-Z]/.test(data.password) || !/[0-9]/.test(data.password) || !/[^A-Za-z0-9]/.test(data.password)) return res.status(400).json({message: 'Use at least 12 characters including upper- and lowercase letters, a number and a symbol.'});
  const row = await prisma.verificationToken.findFirst({where: {tokenHash: tokenHash(data.token), purpose: 'PASSWORD_RESET', usedAt: null, expiresAt: {gt: new Date()}}});
  if (!row) return res.status(400).json({message: 'This reset link is invalid or has expired. Request a new one.'});
  const now = new Date();
  await prisma.$transaction([
    prisma.user.update({where: {id: row.userId}, data: {passwordHash: await hashPassword(data.password)}}),
    prisma.verificationToken.updateMany({where: {userId: row.userId, purpose: 'PASSWORD_RESET', usedAt: null}, data: {usedAt: now}}),
    prisma.session.updateMany({where: {userId: row.userId, revokedAt: null}, data: {revokedAt: now}}),
  ]);
  return res.json({message: 'Password changed. Please sign in again.'});
}));

app.get('/api/services', asyncRoute(async (_req, res) => {
  const services = await prisma.serviceCatalog.findMany({where: {isActive: true}, orderBy: [{category: 'asc'}, {name: 'asc'}], select: {id: true, name: true, slug: true, category: true, description: true, feePaise: true, durationMin: true}});
  return res.json({services});
}));
app.get('/api/availability', asyncRoute(async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date();
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return res.status(400).json({message: 'Invalid date range.'});
  const where: Prisma.AvailabilitySlotWhereInput = {isActive: true, isBooked: false, startsAt: {gte: from, lte: to}};
  if (req.query.service) where.serviceSlug = String(req.query.service).slice(0, 100);
  const slots = await prisma.availabilitySlot.findMany({where, orderBy: {startsAt: 'asc'}, take: 100, select: {id: true, startsAt: true, endsAt: true, serviceSlug: true}});
  return res.json({slots});
}));

app.post('/api/contact', optionalAuth, validate(z.object({name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254), topic: z.string().max(100).optional(), details: z.string().trim().min(5).max(5000)}), async (req, res, data) => {
  const row = await prisma.contactEnquiry.create({data: {name: data.name, email: data.email.toLowerCase(), topic: data.topic || 'General', message: data.details}});
  await audit(req, (req as AuthRequest).authUser?.id || null, 'CONTACT_ENQUIRY_CREATED', 'ContactEnquiry', row.id);
  return res.status(201).json({id: row.id, reference: ref('ENQ'), message: 'Enquiry received.'});
}));

app.post('/api/property-assessments', requireAuth, validate(z.object({propertyType: z.string().min(2).max(100), state: z.string().min(2).max(100), district: z.string().min(2).max(100), locality: z.string().max(180).optional(), surveyNumber: z.string().max(120).optional(), area: z.string().max(100).optional(), transactionType: z.string().max(100).optional(), email: z.string().trim().email().max(254), phone: z.string().max(40).optional(), details: z.string().trim().min(5).max(5000)}), async (req, res, data) => {
  const user = (req as AuthRequest).authUser;
  const row = await prisma.propertyAssessment.create({data: {userId: user?.id, propertyType: data.propertyType, state: data.state, district: data.district, locality: data.locality, surveyNumber: data.surveyNumber, area: data.area, transactionType: data.transactionType, email: data.email.toLowerCase(), phone: data.phone, details: data.details, reference: ref('PROP'), status: 'SUBMITTED'}});
  await audit(req, user?.id || null, 'PROPERTY_ASSESSMENT_CREATED', 'PropertyAssessment', row.id);
  return res.status(201).json({id: row.id, reference: row.reference, message: 'Assessment request received. This is not a legal opinion or property clearance.'});
}));

app.post('/api/bookings', requireAuth, validate(z.object({service: z.string().min(2).max(150), serviceSlug: z.string().max(120).optional(), slotId: z.string().uuid().optional(), preferredDate: z.string().max(40).optional(), consultationMethod: z.string().max(80).optional(), name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254), details: z.string().trim().min(5).max(5000)}), async (req, res, data) => {
  const auth = (req as AuthRequest).authUser;
  const service = data.serviceSlug ? await prisma.serviceCatalog.findFirst({where: {slug: data.serviceSlug, isActive: true}}) : await prisma.serviceCatalog.findFirst({where: {name: {equals: data.service, mode: 'insensitive'}, isActive: true}});
  const amountPaise = service?.feePaise || 0;
  if (amountPaise > 0 && service?.category.toUpperCase() === 'CONSULTATION' && !data.slotId) return res.status(400).json({message: 'Choose an available appointment slot before requesting a paid consultation.'});
  if (amountPaise > 0 && !auth) return res.status(401).json({message: 'Create an account and sign in before requesting a paid consultation.'});
  if (amountPaise > 0 && auth && !auth.emailVerifiedAt) return res.status(403).json({message: 'Verify your email before requesting a paid consultation.'});
  if (data.slotId && !auth) return res.status(401).json({message: 'Sign in before reserving an appointment slot.'});
  const date = data.preferredDate ? new Date(data.preferredDate) : undefined;
  if (data.preferredDate && (!date || Number.isNaN(date.getTime()))) return res.status(400).json({message: 'Invalid preferred date.'});
  let row;
  if (data.slotId) {
    row = await prisma.$transaction(async tx => {
      const slot = await tx.availabilitySlot.findUnique({where: {id: data.slotId}});
      if (!slot || !slot.isActive || slot.isBooked || slot.startsAt <= new Date()) throw new HttpError(409, 'This appointment slot is no longer available. Please choose another time.');
      if (service?.slug && slot.serviceSlug && slot.serviceSlug !== service.slug) throw new HttpError(400, 'The selected time does not match this service.');
      const claimed = await tx.availabilitySlot.updateMany({where: {id: slot.id, isActive: true, isBooked: false}, data: {isBooked: true}});
      if (claimed.count !== 1) throw new HttpError(409, 'This appointment slot was just reserved by someone else. Please choose another time.');
      const requiresPayment = amountPaise > 0;
      return tx.bookingRequest.create({data: {userId: auth!.id, reference: ref('BOOK'), service: service?.name || data.service, serviceCatalogId: service?.id, slotId: slot.id, preferredDate: slot.startsAt, consultationMethod: data.consultationMethod, name: data.name, email: data.email.toLowerCase(), details: data.details, amountPaise, currency: 'INR', paymentStatus: requiresPayment ? 'AWAITING_PAYMENT' : 'NOT_REQUIRED', status: requiresPayment ? 'AWAITING_PAYMENT' : 'CONFIRMED'}});
    }, {isolationLevel: Prisma.TransactionIsolationLevel.Serializable});
  } else {
    row = await prisma.bookingRequest.create({data: {userId: auth?.id, reference: ref('BOOK'), service: service?.name || data.service, serviceCatalogId: service?.id, preferredDate: date, consultationMethod: data.consultationMethod, name: data.name, email: data.email.toLowerCase(), details: data.details, amountPaise, currency: 'INR', paymentStatus: amountPaise > 0 ? 'AWAITING_PAYMENT' : 'NOT_REQUIRED', status: amountPaise > 0 ? 'AWAITING_PAYMENT' : 'REQUESTED'}});
  }
  await audit(req, auth?.id || null, 'BOOKING_REQUEST_CREATED', 'BookingRequest', row.id, {service: row.service, amountPaise: row.amountPaise});
  return res.status(201).json({id: row.id, reference: row.reference, status: row.status, amountPaise: row.amountPaise, currency: row.currency, message: row.status === 'CONFIRMED' ? 'Appointment slot reserved.' : row.amountPaise > 0 ? 'Request recorded. Sign in and complete verified payment to confirm this paid service.' : 'Booking request received; this is not a confirmed appointment.'});
}));

app.post('/api/disputes', requireAuth, validate(z.object({category: z.string().min(2).max(120), state: z.string().min(2).max(100), opposingParty: z.string().min(2).max(200), arbitrationAgreement: z.string().max(30).optional(), deadline: z.string().max(100).optional(), reliefSought: z.string().max(3000).optional(), agreementDetails: z.string().max(3000).optional(), name: z.string().trim().min(2).max(120), email: z.string().trim().email().max(254), details: z.string().trim().min(5).max(5000)}), async (req, res, data) => {
  const user = (req as AuthRequest).authUser;
  const row = await prisma.$transaction(async tx => {
    const created = await tx.disputeCase.create({data: {userId: user?.id, reference: ref('CASE'), category: data.category, state: data.state, opposingParty: data.opposingParty, arbitrationAgreement: data.arbitrationAgreement, deadline: data.deadline, reliefSought: data.reliefSought, agreementDetails: data.agreementDetails, applicantName: data.name, email: data.email.toLowerCase(), statement: data.details, status: 'SUBMITTED'}});
    await tx.caseStatusEvent.create({data: {disputeCaseId: created.id, fromStatus: null, toStatus: 'SUBMITTED', actorId: user?.id || null, note: 'Dispute intake submitted.'}});
    return created;
  });
  await audit(req, user?.id || null, 'DISPUTE_INTAKE_CREATED', 'DisputeCase', row.id);
  return res.status(201).json({id: row.id, reference: row.reference, message: 'Dispute outline received for preliminary screening only. It is not automatically accepted for arbitration.'});
}));

app.get('/api/me/records', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const [assessments, bookings, disputes, payments, invoices, documents, savedArticles] = await Promise.all([
    prisma.propertyAssessment.findMany({where: {userId: user.id}, orderBy: {createdAt: 'desc'}, select: {id: true, reference: true, propertyType: true, state: true, district: true, status: true, createdAt: true, updatedAt: true}}),
    prisma.bookingRequest.findMany({where: {userId: user.id}, orderBy: {createdAt: 'desc'}, include: {slot: {select: {startsAt: true, endsAt: true}}, serviceCatalog: {select: {name: true}}}}),
    prisma.disputeCase.findMany({where: {userId: user.id}, orderBy: {createdAt: 'desc'}, select: {id: true, reference: true, category: true, state: true, status: true, paymentStatus: true, feePaise: true, createdAt: true, updatedAt: true}}),
    prisma.payment.findMany({where: {userId: user.id}, orderBy: {createdAt: 'desc'}, select: {id: true, amountPaise: true, currency: true, status: true, gateway: true, createdAt: true, invoice: {select: {id: true, invoiceNo: true, amountPaise: true, currency: true, issuedAt: true}}, refunds: {select: {id: true, amountPaise: true, status: true, reason: true, createdAt: true}}, booking: {select: {reference: true, service: true}}, disputeCase: {select: {reference: true, category: true}}}}),
    prisma.invoice.findMany({where: {userId: user.id}, orderBy: {issuedAt: 'desc'}, select: {id: true, invoiceNo: true, amountPaise: true, currency: true, issuedAt: true}}),
    prisma.document.findMany({where: {userId: user.id, deletedAt: null}, orderBy: {createdAt: 'desc'}, select: {id: true, originalName: true, mimeType: true, sizeBytes: true, assessmentId: true, disputeCaseId: true, bookingId: true, createdAt: true}}),
    prisma.savedArticle.findMany({where: {userId: user.id}, include: {article: {select: {id: true, title: true, slug: true, excerpt: true, category: true}}}, orderBy: {createdAt: 'desc'}}),
  ]);
  return res.json({assessments, bookings, disputes, payments, invoices, documents, savedArticles: savedArticles.map(x => x.article)});
}));

// Authenticated case tracking and case communication.
app.get('/api/cases/:id', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const row = await prisma.disputeCase.findUnique({where: {id: req.params.id}, include: {assignedReviewer: {select: {id: true, name: true}}, messages: {where: {isInternal: false}, include: {user: {select: {name: true, role: true}},}, orderBy: {createdAt: 'asc'}}, milestones: {orderBy: {dueAt: 'asc'}}, statusEvents: {select: {id: true, fromStatus: true, toStatus: true, createdAt: true}, orderBy: {createdAt: 'asc'}}, documents: {where: {deletedAt: null}, select: {id: true, originalName: true, sizeBytes: true, mimeType: true, createdAt: true}}}});
  if (!row) return res.status(404).json({message: 'Case not found.'});
  if (row.userId !== user.id && !(user.role === 'ADMIN' || (user.role === 'REVIEWER' && row.assignedReviewerId === user.id))) return res.status(404).json({message: 'Case not found.'});
  return res.json({case: row});
}));
app.post('/api/cases/:id/messages', requireAuth, validate(z.object({body: z.string().trim().min(1).max(4000)}), async (req, res, data) => {
  const user = currentUser(req);
  const c = await prisma.disputeCase.findUnique({where: {id: req.params.id}, select: {id: true, userId: true, assignedReviewerId: true}});
  if (!c || (c.userId !== user.id && !(user.role === 'ADMIN' || (user.role === 'REVIEWER' && c.assignedReviewerId === user.id)))) return res.status(404).json({message: 'Case not found.'});
  const message = await prisma.caseMessage.create({data: {disputeCaseId: c.id, userId: user.id, senderRole: user.role, body: data.body, isInternal: false}, include: {user: {select: {name: true, role: true}}}});
  await audit(req, user.id, 'CASE_MESSAGE_CREATED', 'DisputeCase', c.id);
  return res.status(201).json({message});
}));

app.post('/api/bookings/:id/cancel', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const booking = await prisma.bookingRequest.findUnique({where: {id: req.params.id}});
  if (!booking || (booking.userId !== user.id && user.role !== 'ADMIN')) return res.status(404).json({message: 'Booking not found.'});
  if (['COMPLETED', 'CANCELLED', 'DECLINED'].includes(booking.status)) return res.status(409).json({message: 'This booking can no longer be cancelled.'});
  if (booking.paymentStatus === 'PAID' || booking.paymentStatus === 'REFUND_PENDING') {
    await prisma.bookingRequest.update({where: {id: booking.id}, data: {status: 'CANCEL_REQUESTED', cancellationReason: 'Customer requested cancellation; refund review is required.'}});
    await audit(req, user.id, 'BOOKING_CANCELLATION_REQUESTED', 'BookingRequest', booking.id);
    return res.json({message: 'Cancellation request recorded. Paid cancellations require review under the published refund policy.'});
  }
  await prisma.$transaction(async tx => {
    await tx.bookingRequest.update({where: {id: booking.id}, data: {status: 'CANCELLED', cancelledAt: new Date()}});
    if (booking.slotId) await tx.availabilitySlot.update({where: {id: booking.slotId}, data: {isBooked: false}});
  });
  await audit(req, user.id, 'BOOKING_CANCELLED', 'BookingRequest', booking.id);
  return res.json({message: 'Booking cancelled.'});
}));

// Private file storage: files are never placed in the public web directory or served by static hosting.
const upload = multer({storage: multer.memoryStorage(), limits: {fileSize: process.env.VERCEL ? 4 * 1024 * 1024 : 15 * 1024 * 1024, files: 1}, fileFilter: (_req, file, callback) => {
  const accepted = ['application/pdf', 'image/jpeg', 'image/png'];
  if (!accepted.includes(file.mimetype)) return callback(new HttpError(400, 'Only PDF, JPEG and PNG files are accepted.'));
  callback(null, true);
}});
function isAllowedFile(bytes: Buffer, mime: string): boolean {
  if (mime === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mime === 'image/jpeg') return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === 'image/png') return bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  return false;
}
const documentUpload: RequestHandler = (req, res, next) => upload.single('file')(req, res, (error: any) => {
  if (error) return res.status(error.status || 400).json({message: error.message || 'Could not upload this file.'});
  next();
});
app.post('/api/documents', requireAuth, requireVerified, documentUpload, asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const file = (req as Request & {file?: Express.Multer.File}).file;
  if (!file) throw new HttpError(400, 'Choose a PDF, JPEG or PNG file to upload.');
  if (!isAllowedFile(file.buffer, file.mimetype)) throw new HttpError(400, 'The uploaded file does not match its declared file type.');
  const assessmentId = safeText(req.body.assessmentId, 60) || undefined;
  const disputeCaseId = safeText(req.body.disputeCaseId, 60) || undefined;
  const bookingId = safeText(req.body.bookingId, 60) || undefined;
  if ([assessmentId, disputeCaseId, bookingId].filter(Boolean).length !== 1) throw new HttpError(400, 'Attach a document to exactly one assessment, dispute or booking.');
  if (assessmentId) {
    const row = await prisma.propertyAssessment.findUnique({where: {id: assessmentId}, select: {id: true, userId: true}});
    if (!row || (row.userId !== user.id && user.role !== 'ADMIN')) throw new HttpError(404, 'Assessment not found.');
  }
  if (disputeCaseId) {
    const row = await prisma.disputeCase.findUnique({where: {id: disputeCaseId}, select: {id: true, userId: true, assignedReviewerId: true}});
    if (!row || (row.userId !== user.id && !(user.role === 'ADMIN' || (user.role === 'REVIEWER' && row.assignedReviewerId === user.id)))) throw new HttpError(404, 'Case not found.');
  }
  if (bookingId) {
    const row = await prisma.bookingRequest.findUnique({where: {id: bookingId}, select: {id: true, userId: true}});
    if (!row || (row.userId !== user.id && user.role !== 'ADMIN')) throw new HttpError(404, 'Booking not found.');
  }
  await mkdir(UPLOAD_DIR, {recursive: true, mode: 0o700});
  const extension = file.mimetype === 'application/pdf' ? '.pdf' : file.mimetype === 'image/jpeg' ? '.jpg' : '.png';
  const storedName = `${randomUUID()}${extension}`;
  const storedPath = path.join(UPLOAD_DIR, storedName);
  await writeFile(storedPath, file.buffer, {flag: 'wx', mode: 0o600});
  const scanRequired = process.env.MALWARE_SCAN_REQUIRED === 'true' || process.env.NODE_ENV === 'production';
  if (scanRequired) {
    try { await execFile(process.env.CLAMSCAN_PATH || 'clamscan', ['--no-summary', '--', storedPath], {timeout: 30_000, maxBuffer: 1024 * 1024}); }
    catch (error: any) {
      await unlink(storedPath).catch(() => undefined);
      if (error?.code === 1) throw new HttpError(400, 'The uploaded file was flagged by malware scanning and was rejected.');
      throw new HttpError(503, 'Required malware scanning is unavailable or failed. Install/configure ClamAV before accepting private documents.');
    }
  }
  const row = await prisma.document.create({data: {userId: user.id, assessmentId, disputeCaseId, bookingId, originalName: cleanFilename(file.originalname), storedName, mimeType: file.mimetype, sizeBytes: file.size, sha256: createHash('sha256').update(file.buffer).digest('hex')}}).catch(async error => {await unlink(storedPath).catch(() => undefined); throw error;});
  await audit(req, user.id, 'PRIVATE_DOCUMENT_UPLOADED', 'Document', row.id, {mimeType: row.mimeType, sizeBytes: row.sizeBytes});
  return res.status(201).json({document: {id: row.id, originalName: row.originalName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, createdAt: row.createdAt}, message: 'Document stored privately.'});
}));

async function mayAccessDocument(user: AuthUser, document: {userId: string; assessmentId: string | null; disputeCaseId: string | null; bookingId: string | null}) {
  if (user.role === 'ADMIN') return true;
  if (document.userId === user.id) return true;
  if (document.assessmentId) { const row = await prisma.propertyAssessment.findUnique({where: {id: document.assessmentId}, select: {userId: true, assignedReviewerId: true}}); if (row?.userId === user.id || (user.role === 'REVIEWER' && row?.assignedReviewerId === user.id)) return true; }
  if (document.bookingId) { const row = await prisma.bookingRequest.findUnique({where: {id: document.bookingId}, select: {userId: true}}); if (row?.userId === user.id) return true; }
  if (document.disputeCaseId) { const row = await prisma.disputeCase.findUnique({where: {id: document.disputeCaseId}, select: {userId: true, assignedReviewerId: true}}); if (row?.userId === user.id || (user.role === 'REVIEWER' && row?.assignedReviewerId === user.id)) return true; }
  return false;
}
app.get('/api/documents/:id/download', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const doc = await prisma.document.findFirst({where: {id: req.params.id, deletedAt: null}});
  if (!doc || !(await mayAccessDocument(user, doc))) return res.status(404).json({message: 'Document not found.'});
  const filePath = path.join(UPLOAD_DIR, doc.storedName);
  await readFile(filePath, {flag: 'r'}).catch(() => { throw new HttpError(404, 'The private document file is no longer available.'); });
  await audit(req, user.id, 'PRIVATE_DOCUMENT_DOWNLOADED', 'Document', doc.id);
  res.setHeader('Content-Type', doc.mimeType);
  res.setHeader('Content-Length', doc.sizeBytes);
  res.setHeader('Content-Disposition', `attachment; filename="${cleanFilename(doc.originalName).replace(/"/g, '')}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  return createReadStream(filePath).pipe(res);
}));
app.delete('/api/documents/:id', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const doc = await prisma.document.findFirst({where: {id: req.params.id, deletedAt: null}});
  if (!doc || !(await mayAccessDocument(user, doc)) || (user.role !== 'ADMIN' && doc.userId !== user.id)) return res.status(404).json({message: 'Document not found.'});
  await prisma.document.update({where: {id: doc.id}, data: {deletedAt: new Date()}});
  await unlink(path.join(UPLOAD_DIR, doc.storedName)).catch(() => undefined);
  await audit(req, user.id, 'PRIVATE_DOCUMENT_DELETED', 'Document', doc.id);
  return res.json({message: 'Document deleted from active storage.'});
}));

// Assessment detail and a transparent, downloadable summary of recorded checks.
app.get('/api/assessments/:id', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const row = await prisma.propertyAssessment.findUnique({where: {id: req.params.id}, include: {checks: {orderBy: {createdAt: 'asc'}}, documents: {where: {deletedAt: null}, select: {id: true, originalName: true, sizeBytes: true, mimeType: true, createdAt: true}}}});
  if (!row || (row.userId !== user.id && !(user.role === 'ADMIN' || (user.role === 'REVIEWER' && row.assignedReviewerId === user.id)))) return res.status(404).json({message: 'Assessment not found.'});
  return res.json({assessment: row});
}));
app.get('/api/assessments/:id/report', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const row = await prisma.propertyAssessment.findUnique({where: {id: req.params.id}, include: {checks: {orderBy: {createdAt: 'asc'}}}});
  if (!row || (row.userId !== user.id && !(user.role === 'ADMIN' || (user.role === 'REVIEWER' && row.assignedReviewerId === user.id)))) return res.status(404).json({message: 'Assessment not found.'});
  const lines = [
    'SVU DEVELOPERS PRIVATE LIMITED', 'PROPERTY ASSESSMENT SUMMARY', `Reference: ${row.reference}`, `Generated: ${new Date().toISOString()}`,
    '', 'PROPERTY DETAILS', `Type: ${row.propertyType}`, `Location: ${row.locality || ''}, ${row.district}, ${row.state}`, `Survey / plot number: ${row.surveyNumber || 'Not supplied'}`, `Area: ${row.area || 'Not supplied'}`, `Transaction: ${row.transactionType || 'Not supplied'}`,
    '', `Status: ${row.status}`, '', 'RECORDED CHECKS',
    ...(row.checks.length ? row.checks.flatMap((c, i) => [`${i + 1}. ${c.title}`, `   Status: ${c.status}`, `   Information reviewed: ${c.informationReviewed || 'Not recorded'}`, `   Source/date: ${c.source || 'Not recorded'} / ${c.sourceDate?.toISOString().slice(0, 10) || 'Not recorded'}`, `   Findings: ${c.findings || 'Not recorded'}`, `   Unresolved issues: ${c.unresolvedIssues || 'Not recorded'}`, `   Missing documents: ${c.missingDocuments || 'Not recorded'}`, `   Recommended next steps: ${c.recommendedNextSteps || 'Not recorded'}`, '']) : ['No checks have been recorded yet.']),
    `Reviewer notes: ${row.reviewerNotes || 'Not recorded'}`, `Report notes: ${row.reportNotes || 'Not recorded'}`, '', 'LIMITATIONS', 'This summary reflects only information saved in the application. It does not itself verify title, ownership, encumbrances, land classification, approvals or legal status. It is not a guarantee, final legal opinion or substitute for appropriately qualified professional review.',
  ];
  await audit(req, user.id, 'ASSESSMENT_REPORT_DOWNLOADED', 'PropertyAssessment', row.id);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${row.reference}-summary.txt"`);
  return res.send(lines.join('\n'));
}));

app.post('/api/track', requireAuth, validate(z.object({reference: z.string().trim().min(4).max(80), email: z.string().trim().email().max(254)}), async (req, res, data) => {
  const user = currentUser(req);
  if (data.email.toLowerCase() !== user.email.toLowerCase()) return res.status(404).json({message: 'No request with that reference is linked to this account.'});
  const [assessment, booking, dispute] = await Promise.all([
    prisma.propertyAssessment.findFirst({where: {reference: data.reference, userId: user.id}, select: {reference: true, status: true, createdAt: true, updatedAt: true}}),
    prisma.bookingRequest.findFirst({where: {reference: data.reference, userId: user.id}, select: {reference: true, status: true, paymentStatus: true, preferredDate: true, createdAt: true, updatedAt: true}}),
    prisma.disputeCase.findFirst({where: {reference: data.reference, userId: user.id}, select: {reference: true, status: true, paymentStatus: true, createdAt: true, updatedAt: true}}),
  ]);
  const result = assessment ? {type: 'Property assessment', ...assessment} : booking ? {type: 'Booking', ...booking} : dispute ? {type: 'Dispute case', ...dispute} : null;
  if (!result) return res.status(404).json({message: 'No request with that reference is linked to this account.'});
  return res.json({result});
}));

// Payment gateway. Amounts are read from persisted service/case data, never from the browser payload.
function razorpayConfigured() { return !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET && process.env.PAYMENTS_ENABLED === 'true'); }
async function razorpayRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) throw new HttpError(503, 'Razorpay credentials are not configured.');
  const auth = Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const response = await fetch(`https://api.razorpay.com/v1${url}`, {...init, headers: {...(init.headers as Record<string, string> || {}), Authorization: `Basic ${auth}`, 'Content-Type': 'application/json'}});
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new HttpError(response.status === 401 ? 502 : 400, data?.error?.description || data?.error?.reason || 'The payment gateway request failed.');
  return data as T;
}
async function markPaymentCaptured(paymentId: string, gatewayPaymentId: string) {
  let newlyCaptured = false;
  await prisma.$transaction(async tx => {
    const payment = await tx.payment.findUnique({where: {id: paymentId}});
    if (!payment || payment.status === 'CAPTURED') return;
    newlyCaptured = true;
    await tx.payment.update({where: {id: paymentId}, data: {status: 'CAPTURED', gatewayPaymentId: gatewayPaymentId || payment.gatewayPaymentId, activeTargetKey: null, failureReason: null}});
    if (payment.bookingId) {
      const booking = await tx.bookingRequest.findUnique({where: {id: payment.bookingId}, select: {slotId: true, status: true}});
      const cancelledOrClosed = !!booking && ['CANCELLED', 'CANCEL_REQUESTED', 'DECLINED', 'COMPLETED'].includes(booking.status);
      await tx.bookingRequest.update({where: {id: payment.bookingId}, data: cancelledOrClosed ? {paymentStatus: 'PAID_AFTER_CANCELLATION_REVIEW'} : {paymentStatus: 'PAID', status: booking?.slotId ? 'CONFIRMED' : 'PAYMENT_RECEIVED'}});
    }
    if (payment.disputeCaseId) {
      const caseRow = await tx.disputeCase.findUnique({where: {id: payment.disputeCaseId}, select: {status: true}});
      const canAdvance = caseRow?.status === 'AWAITING_PAYMENT';
      const nextStatus = canAdvance ? 'PROFESSIONAL_REVIEW' : (caseRow?.status || 'PROFESSIONAL_REVIEW');
      await tx.disputeCase.update({where: {id: payment.disputeCaseId}, data: {paymentStatus: canAdvance ? 'PAID' : 'PAID_AFTER_CASE_CHANGED_REVIEW', status: nextStatus}});
      if (caseRow && canAdvance) await tx.caseStatusEvent.create({data: {disputeCaseId: payment.disputeCaseId, fromStatus: caseRow.status, toStatus: nextStatus, note: 'Gateway payment capture verified.', actorId: null}});
    }
    const invoiceExisting = await tx.invoice.findUnique({where: {paymentId: payment.id}});
    if (!invoiceExisting) await tx.invoice.create({data: {invoiceNo: `SVU-${new Date().getFullYear()}-${payment.id.slice(0, 8).toUpperCase()}`, userId: payment.userId, bookingId: payment.bookingId, paymentId: payment.id, amountPaise: payment.amountPaise, currency: payment.currency}});
  });
  if (!newlyCaptured) return;
  const detail = await prisma.payment.findUnique({where: {id: paymentId}, include: {user: {select: {name: true, email: true}}, booking: {select: {reference: true, service: true, status: true, paymentStatus: true}}, disputeCase: {select: {reference: true, category: true, status: true, paymentStatus: true}}}});
  if (detail) {
    const exception = detail.booking?.paymentStatus === 'PAID_AFTER_CANCELLATION_REVIEW' || detail.disputeCase?.paymentStatus === 'PAID_AFTER_CASE_CHANGED_REVIEW';
    await notifySafely(detail.user.email, exception ? 'Payment received — service review required' : 'Payment received — SVU Developers', `Hello ${detail.user.name},\n\nA payment of INR ${(detail.amountPaise / 100).toFixed(2)} for ${detail.booking?.reference || detail.disputeCase?.reference || 'your service'} has been verified by the payment server.${exception ? '\n\nThe request status changed while the payment was pending. This transaction has been flagged for administrative review; do not assume the booking or service is confirmed.' : ''}\n\nKeep your invoice in the customer dashboard. This receipt does not constitute a legal opinion or guarantee of an outcome.`);
    if (exception && process.env.ADMIN_INITIAL_EMAIL) await notifySafely(process.env.ADMIN_INITIAL_EMAIL, 'URGENT: payment captured after target status changed', `Payment ${detail.id} for ${detail.booking?.reference || detail.disputeCase?.reference || 'service'} was captured after its target status changed. Review payment and fulfilment/refund immediately.`);
  }
}
app.get('/api/payments/config', (_req, res) => res.json({enabled: razorpayConfigured(), keyId: razorpayConfigured() ? process.env.RAZORPAY_KEY_ID : null, currency: 'INR'}));
app.post('/api/payments/order', requireAuth, requireVerified, validate(z.object({bookingId: z.string().uuid().optional(), disputeCaseId: z.string().uuid().optional()}), async (req, res, data) => {
  if (!razorpayConfigured()) return res.status(503).json({message: 'Online payments are disabled. Configure approved Razorpay test credentials and set PAYMENTS_ENABLED=true to enable sandbox checkout.'});
  if (!!data.bookingId === !!data.disputeCaseId) return res.status(400).json({message: 'Choose exactly one booking or dispute case to pay for.'});
  const user = currentUser(req);
  let targetKey: string; let amountPaise: number; let receiptTarget: string; let bookingId: string | undefined; let disputeCaseId: string | undefined;
  if (data.bookingId) {
    const b = await prisma.bookingRequest.findUnique({where: {id: data.bookingId}});
    if (!b || b.userId !== user.id) return res.status(404).json({message: 'Booking not found.'});
    if (b.amountPaise <= 0) return res.status(400).json({message: 'This booking does not have a configured fee.'});
    if (b.status !== 'AWAITING_PAYMENT' || b.paymentStatus !== 'AWAITING_PAYMENT') return res.status(409).json({message: 'This booking is not currently awaiting payment. Contact the service team if a payment is still pending.'});
    amountPaise = b.amountPaise; bookingId = b.id; targetKey = `booking:${b.id}`; receiptTarget = b.reference;
  } else {
    const c = await prisma.disputeCase.findUnique({where: {id: data.disputeCaseId!}});
    if (!c || c.userId !== user.id) return res.status(404).json({message: 'Dispute case not found.'});
    if (c.feePaise <= 0) return res.status(400).json({message: 'A professional must configure the agreed fee before payment is available.'});
    if (c.status !== 'AWAITING_PAYMENT') return res.status(409).json({message: 'Payment is available only after the service scope and fee have been reviewed and marked as awaiting payment.'});
    if (c.paymentStatus === 'PAID') return res.status(409).json({message: 'This case fee has already been paid.'});
    amountPaise = c.feePaise; disputeCaseId = c.id; targetKey = `case:${c.id}`; receiptTarget = c.reference;
  }
  const active = await prisma.payment.findFirst({where: {activeTargetKey: targetKey, status: {in: ['CREATING', 'CREATED', 'PENDING_CAPTURE']}}});
  if (active?.gatewayOrderId) return res.json({paymentId: active.id, orderId: active.gatewayOrderId, amountPaise: active.amountPaise, currency: active.currency, keyId: process.env.RAZORPAY_KEY_ID});
  const idempotencyKey = `${targetKey}:${safeText(req.get('idempotency-key'), 80) || randomToken(12)}`;
  const existingKey = await prisma.payment.findUnique({where: {idempotencyKey}});
  if (existingKey?.gatewayOrderId) return res.json({paymentId: existingKey.id, orderId: existingKey.gatewayOrderId, amountPaise: existingKey.amountPaise, currency: existingKey.currency, keyId: process.env.RAZORPAY_KEY_ID});
  let payment;
  try {
    payment = await prisma.payment.create({data: {userId: user.id, bookingId, disputeCaseId, amountPaise, currency: 'INR', status: 'CREATING', idempotencyKey, activeTargetKey: targetKey}});
  } catch (error) {
    const inFlight = await prisma.payment.findFirst({where: {activeTargetKey: targetKey, status: {in: ['CREATING', 'CREATED', 'PENDING_CAPTURE']}}});
    if (inFlight?.gatewayOrderId) return res.json({paymentId: inFlight.id, orderId: inFlight.gatewayOrderId, amountPaise: inFlight.amountPaise, currency: inFlight.currency, keyId: process.env.RAZORPAY_KEY_ID});
    throw error;
  }
  try {
    const order = await razorpayRequest<{id: string; amount: number; currency: string; status: string}>('/orders', {method: 'POST', body: JSON.stringify({amount: amountPaise, currency: 'INR', receipt: receiptTarget.slice(0, 40), notes: {svuPaymentId: payment.id, target: targetKey}})});
    await prisma.payment.update({where: {id: payment.id}, data: {gatewayOrderId: order.id, status: 'CREATED'}});
    await audit(req, user.id, 'PAYMENT_ORDER_CREATED', 'Payment', payment.id, {amountPaise, currency: 'INR'});
    return res.status(201).json({paymentId: payment.id, orderId: order.id, amountPaise, currency: 'INR', keyId: process.env.RAZORPAY_KEY_ID, name: 'SVU Developers Private Limited', description: `Payment for ${receiptTarget}`});
  } catch (error) {
    await prisma.payment.update({where: {id: payment.id}, data: {status: 'FAILED', activeTargetKey: null, failureReason: error instanceof Error ? error.message.slice(0, 500) : 'Gateway order could not be created'}});
    throw error;
  }
}));
app.post('/api/payments/verify', requireAuth, requireVerified, validate(z.object({paymentId: z.string().uuid(), razorpay_order_id: z.string().min(3).max(150), razorpay_payment_id: z.string().min(3).max(150), razorpay_signature: z.string().min(20).max(500)}), async (req, res, data) => {
  if (!process.env.RAZORPAY_KEY_SECRET) return res.status(503).json({message: 'Payment verification is not configured.'});
  const user = currentUser(req);
  const payment = await prisma.payment.findFirst({where: {id: data.paymentId, userId: user.id, gatewayOrderId: data.razorpay_order_id}});
  if (!payment) return res.status(404).json({message: 'Payment order not found.'});
  if (payment.status === 'CAPTURED') return res.json({status: 'CAPTURED', message: 'Payment is already verified.'});
  const expected = hmacSha256(process.env.RAZORPAY_KEY_SECRET, `${data.razorpay_order_id}|${data.razorpay_payment_id}`);
  if (!safeEqual(expected, data.razorpay_signature)) {
    await audit(req, user.id, 'PAYMENT_SIGNATURE_REJECTED', 'Payment', payment.id);
    return res.status(400).json({message: 'Payment signature verification failed.'});
  }
  const remotePayment = await razorpayRequest<{id: string; order_id: string; status: string; amount: number; currency: string}>(`/payments/${encodeURIComponent(data.razorpay_payment_id)}`, {method: 'GET'});
  if (remotePayment.order_id !== payment.gatewayOrderId || remotePayment.amount !== payment.amountPaise || remotePayment.currency !== payment.currency) return res.status(400).json({message: 'Payment details do not match the server-created order.'});
  if (remotePayment.status !== 'captured') {
    await prisma.payment.update({where: {id: payment.id}, data: {status: 'PENDING_CAPTURE', gatewayPaymentId: data.razorpay_payment_id, signatureVerifiedAt: new Date()}});
    return res.json({status: 'PENDING_CAPTURE', message: 'The checkout signature is valid, but the gateway has not confirmed capture yet. The page will update when the gateway confirms it.'});
  }
  await prisma.payment.update({where: {id: payment.id}, data: {gatewayPaymentId: data.razorpay_payment_id, signatureVerifiedAt: new Date()}});
  await markPaymentCaptured(payment.id, data.razorpay_payment_id);
  await audit(req, user.id, 'PAYMENT_CAPTURE_VERIFIED', 'Payment', payment.id, {gatewayPaymentId: data.razorpay_payment_id});
  return res.json({status: 'CAPTURED', message: 'Payment verified by the server.'});
}));
app.get('/api/payments', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const payments = await prisma.payment.findMany({where: {userId: user.id}, orderBy: {createdAt: 'desc'}, include: {invoice: true, refunds: {select: {id: true, amountPaise: true, status: true, reason: true, createdAt: true}}, booking: {select: {reference: true, service: true}}, disputeCase: {select: {reference: true, category: true}}}});
  return res.json({payments});
}));
app.post('/api/payments/:id/refund-request', requireAuth, validate(z.object({reason: z.string().trim().min(5).max(1000)}), async (req, res, data) => {
  const user = currentUser(req);
  const result = await prisma.$transaction(async tx => {
    const payment = await tx.payment.findFirst({where: {id: req.params.id, userId: user.id}});
    if (!payment || payment.status !== 'CAPTURED') throw new HttpError(404, 'A captured payment linked to this account was not found.');
    const previous = await tx.refund.aggregate({where: {paymentId: payment.id, status: {in: ['PENDING', 'PROCESSING', 'PROCESSED', 'NEEDS_RECONCILIATION']}}, _sum: {amountPaise: true}});
    const reserved = previous._sum.amountPaise || 0;
    if (reserved >= payment.amountPaise) throw new HttpError(409, 'A full refund has already been requested or issued for this payment.');
    const amountPaise = payment.amountPaise - reserved;
    const refund = await tx.refund.create({data: {paymentId: payment.id, amountPaise, reason: data.reason, requestedById: user.id, status: 'PENDING'}});
    if (payment.bookingId) await tx.bookingRequest.update({where: {id: payment.bookingId}, data: {paymentStatus: 'REFUND_PENDING'}});
    if (payment.disputeCaseId) await tx.disputeCase.update({where: {id: payment.disputeCaseId}, data: {paymentStatus: 'REFUND_PENDING'}});
    return {refund, paymentId: payment.id, amountPaise};
  }, {isolationLevel: Prisma.TransactionIsolationLevel.Serializable});
  await audit(req, user.id, 'CUSTOMER_REFUND_REQUESTED', 'Refund', result.refund.id, {paymentId: result.paymentId, amountPaise: result.amountPaise});
  return res.status(201).json({refund: {id: result.refund.id, amountPaise: result.refund.amountPaise, status: result.refund.status}, message: 'Refund request submitted for administrative review. It is not yet approved or processed.'});
}));

app.get('/api/invoices/:id', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const invoice = await prisma.invoice.findUnique({where: {id: req.params.id}, include: {payment: true, booking: true, user: {select: {name: true, email: true}}}});
  if (!invoice || (invoice.userId !== user.id && user.role !== 'ADMIN')) return res.status(404).json({message: 'Invoice not found.'});
  const lines = ['SVU DEVELOPERS PRIVATE LIMITED', `Invoice: ${invoice.invoiceNo}`, `Issued: ${invoice.issuedAt.toISOString()}`, `Customer: ${invoice.user.name} (${invoice.user.email})`, `Reference: ${invoice.booking?.reference || invoice.payment.disputeCaseId || 'Professional service'}`, `Amount: INR ${(invoice.amountPaise / 100).toFixed(2)}`, `Payment status: ${invoice.payment.status}`, `Gateway payment ID: ${invoice.payment.gatewayPaymentId || 'Not available'}`, '', 'This receipt records a payment processed through the configured payment gateway. Tax details should be configured and reviewed by the business accountant before production use.'];
  res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="${invoice.invoiceNo}.txt"`);
  return res.send(lines.join('\n'));
}));

// Public knowledge articles and authenticated bookmarks.
app.get('/api/articles', asyncRoute(async (req, res) => {
  const search = safeText(req.query.q, 100);
  const category = safeText(req.query.category, 80);
  const where: Prisma.ArticleWhereInput = {status: 'PUBLISHED'};
  if (category) where.category = category;
  if (search) where.OR = [{title: {contains: search, mode: 'insensitive'}}, {excerpt: {contains: search, mode: 'insensitive'}}, {bodyMarkdown: {contains: search, mode: 'insensitive'}}];
  const articles = await prisma.article.findMany({where, orderBy: {updatedAt: 'desc'}, take: 100, select: {id: true, title: true, slug: true, excerpt: true, category: true, tags: true, readingMinutes: true, lastReviewedAt: true, updatedAt: true}});
  return res.json({articles});
}));
app.get('/api/articles/:slug', asyncRoute(async (req, res) => {
  const article = await prisma.article.findFirst({where: {slug: req.params.slug, status: 'PUBLISHED'}, select: {id: true, title: true, slug: true, excerpt: true, bodyMarkdown: true, category: true, tags: true, readingMinutes: true, lastReviewedAt: true, updatedAt: true}});
  if (!article) return res.status(404).json({message: 'Article not found.'});
  return res.json({article});
}));
app.post('/api/articles/:id/bookmark', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req); const article = await prisma.article.findFirst({where: {id: req.params.id, status: 'PUBLISHED'}});
  if (!article) return res.status(404).json({message: 'Article not found.'});
  await prisma.savedArticle.upsert({where: {userId_articleId: {userId: user.id, articleId: article.id}}, create: {userId: user.id, articleId: article.id}, update: {}});
  return res.json({saved: true});
}));
app.delete('/api/articles/:id/bookmark', requireAuth, asyncRoute(async (req, res) => {
  const user = currentUser(req); await prisma.savedArticle.deleteMany({where: {userId: user.id, articleId: req.params.id}}); return res.json({saved: false});
}));

// Reviewer portal: reviewers only receive matters explicitly assigned to their account.
app.get('/api/reviewer/overview', requireAuth, requireRole('REVIEWER'), asyncRoute(async (req, res) => {
  const user = currentUser(req);
  const [assessments, cases] = await Promise.all([
    prisma.propertyAssessment.findMany({where: {assignedReviewerId: user.id}, orderBy: {updatedAt: 'desc'}, take: 100, include: {checks: {orderBy: {createdAt: 'desc'}}, documents: {where: {deletedAt: null}, select: {id: true, originalName: true, sizeBytes: true, mimeType: true, createdAt: true}}}}),
    prisma.disputeCase.findMany({where: {assignedReviewerId: user.id}, orderBy: {updatedAt: 'desc'}, take: 100, select: {id: true, reference: true, category: true, state: true, opposingParty: true, applicantName: true, email: true, status: true, feePaise: true, paymentStatus: true, reviewerNotes: true, createdAt: true, updatedAt: true}}),
  ]);
  return res.json({assessments, cases});
}));

// Administrative API is protected by an individual authenticated role, not a shared browser-visible key.
app.get('/api/admin/overview', requireAuth, requireRole('ADMIN'), asyncRoute(async (_req, res) => {
  const [contacts, assessments, bookings, disputes, payments, pendingPayments, refunds, users, recentContacts, recentAssessments, recentBookings, recentDisputes] = await Promise.all([
    prisma.contactEnquiry.count(), prisma.propertyAssessment.count(), prisma.bookingRequest.count(), prisma.disputeCase.count(), prisma.payment.aggregate({where: {status: 'CAPTURED'}, _sum: {amountPaise: true}}), prisma.payment.count({where: {status: {in: ['CREATING', 'CREATED', 'PENDING_CAPTURE']}}}), prisma.refund.count({where: {status: {in: ['PENDING', 'PROCESSING', 'NEEDS_RECONCILIATION']}}}), prisma.user.count(),
    prisma.contactEnquiry.findMany({take: 50, orderBy: {createdAt: 'desc'}}), prisma.propertyAssessment.findMany({take: 50, orderBy: {createdAt: 'desc'}, include: {documents: {where: {deletedAt: null}, select: {id: true, originalName: true, sizeBytes: true}}}}), prisma.bookingRequest.findMany({take: 50, orderBy: {createdAt: 'desc'}, include: {slot: true, documents: {where: {deletedAt: null}, select: {id: true, originalName: true, sizeBytes: true}}}}), prisma.disputeCase.findMany({take: 50, orderBy: {createdAt: 'desc'}, include: {documents: {where: {deletedAt: null}, select: {id: true, originalName: true, sizeBytes: true}}}}),
  ]);
  return res.json({counts: {contacts, assessments, bookings, disputes, users, capturedAmountPaise: payments._sum.amountPaise || 0, pendingPayments, pendingRefunds: refunds}, contactEnquiries: recentContacts, propertyAssessments: recentAssessments, bookingRequests: recentBookings, disputeCases: recentDisputes});
}));
app.get('/api/admin/users', requireAuth, requireRole('ADMIN'), asyncRoute(async (req, res) => {
  const q = safeText(req.query.q, 100);
  const users = await prisma.user.findMany({where: q ? {OR: [{name: {contains: q, mode: 'insensitive'}}, {email: {contains: q, mode: 'insensitive'}}]} : {}, take: 100, orderBy: {createdAt: 'desc'}, select: {id: true, name: true, email: true, role: true, isSuspended: true, emailVerifiedAt: true, createdAt: true}});
  return res.json({users});
}));
app.patch('/api/admin/users/:id', requireAuth, requireRole('ADMIN'), validate(z.object({role: z.enum(['CUSTOMER', 'REVIEWER', 'ADMIN']).optional(), isSuspended: z.boolean().optional()}), async (req, res, data) => {
  if (req.params.id === currentUser(req).id && (data.isSuspended === true || data.role && data.role !== 'ADMIN')) return res.status(400).json({message: 'You cannot suspend yourself or remove your own administrator role.'});
  if (data.role === undefined && data.isSuspended === undefined) return res.status(400).json({message: 'No user changes were supplied.'});
  const user = await prisma.user.update({where: {id: req.params.id}, data, select: {id: true, name: true, email: true, role: true, isSuspended: true}});
  if (data.isSuspended) await prisma.session.updateMany({where: {userId: user.id, revokedAt: null}, data: {revokedAt: new Date()}});
  await audit(req, currentUser(req).id, 'USER_SETTINGS_CHANGED', 'User', user.id, {role: user.role, isSuspended: user.isSuspended});
  return res.json({user});
}));

app.get('/api/admin/services', requireAuth, requireRole('ADMIN'), asyncRoute(async (_req, res) => res.json({services: await prisma.serviceCatalog.findMany({orderBy: {createdAt: 'desc'}})})));
const serviceSchema = z.object({name: z.string().trim().min(2).max(120), slug: z.string().trim().min(2).max(120).regex(/^[a-z0-9-]+$/), category: z.string().max(80).default('CONSULTATION'), description: z.string().trim().min(10).max(5000), feePaise: z.number().int().min(0).max(100000000).default(0), durationMin: z.number().int().min(10).max(480).default(30), isActive: z.boolean().default(false)});
app.post('/api/admin/services', requireAuth, requireRole('ADMIN'), validate(serviceSchema, async (req, res, data) => {
  const row = await prisma.serviceCatalog.create({data}); await audit(req, currentUser(req).id, 'SERVICE_CREATED', 'ServiceCatalog', row.id); return res.status(201).json({service: row});
}));
app.patch('/api/admin/services/:id', requireAuth, requireRole('ADMIN'), validate(serviceSchema.partial(), async (req, res, data) => {
  const row = await prisma.serviceCatalog.update({where: {id: req.params.id}, data}); await audit(req, currentUser(req).id, 'SERVICE_UPDATED', 'ServiceCatalog', row.id); return res.json({service: row});
}));
app.get('/api/admin/slots', requireAuth, requireRole('ADMIN'), asyncRoute(async (_req, res) => res.json({slots: await prisma.availabilitySlot.findMany({orderBy: {startsAt: 'desc'}, take: 200})})));
app.post('/api/admin/slots', requireAuth, requireRole('ADMIN'), validate(z.object({startsAt: z.string().datetime(), endsAt: z.string().datetime(), serviceSlug: z.string().max(120).optional()}), async (req, res, data) => {
  const startsAt = new Date(data.startsAt); const endsAt = new Date(data.endsAt);
  if (startsAt <= new Date() || endsAt <= startsAt) return res.status(400).json({message: 'Choose a future start time and an end time after the start.'});
  const row = await prisma.availabilitySlot.create({data: {startsAt, endsAt, serviceSlug: data.serviceSlug}}); await audit(req, currentUser(req).id, 'AVAILABILITY_SLOT_CREATED', 'AvailabilitySlot', row.id); return res.status(201).json({slot: row});
}));
app.patch('/api/admin/slots/:id', requireAuth, requireRole('ADMIN'), validate(z.object({isActive: z.boolean().optional()}), async (req, res, data) => {
  const row = await prisma.availabilitySlot.update({where: {id: req.params.id}, data}); await audit(req, currentUser(req).id, 'AVAILABILITY_SLOT_UPDATED', 'AvailabilitySlot', row.id); return res.json({slot: row});
}));

app.get('/api/admin/assessments/:id', requireAuth, requireRole('ADMIN', 'REVIEWER'), asyncRoute(async (req, res) => {
  const row = await prisma.propertyAssessment.findUnique({where: {id: req.params.id}, include: {checks: true, documents: {where: {deletedAt: null}}}});
  const user = currentUser(req); if (!row || (user.role === 'REVIEWER' && row.assignedReviewerId !== user.id)) return res.status(404).json({message: 'Assessment not found.'}); return res.json({assessment: row});
}));
app.post('/api/admin/assessments/:id/checks', requireAuth, requireRole('ADMIN', 'REVIEWER'), validate(z.object({title: z.string().trim().min(2).max(200), status: z.enum(['NOT_STARTED', 'DOCUMENTS_REQUESTED', 'UNDER_REVIEW', 'COMPLETED', 'INFORMATION_NEEDED', 'PROFESSIONAL_REVIEW_REQUIRED']).default('NOT_STARTED'), informationReviewed: z.string().max(3000).optional(), source: z.string().max(500).optional(), sourceDate: z.string().datetime().optional(), findings: z.string().max(5000).optional(), unresolvedIssues: z.string().max(3000).optional(), missingDocuments: z.string().max(3000).optional(), recommendedNextSteps: z.string().max(3000).optional()}), async (req, res, data) => {
  const assessment = await prisma.propertyAssessment.findUnique({where: {id: req.params.id}, select: {id: true, assignedReviewerId: true}}); const actor = currentUser(req); if (!assessment || (actor.role === 'REVIEWER' && assessment.assignedReviewerId !== actor.id)) return res.status(404).json({message: 'Assessment not found.'});
  const row = await prisma.assessmentCheck.create({data: {...data, sourceDate: data.sourceDate ? new Date(data.sourceDate) : undefined, assessmentId: assessment.id, reviewerId: actor.id}});
  await audit(req, currentUser(req).id, 'ASSESSMENT_CHECK_ADDED', 'PropertyAssessment', assessment.id, {checkId: row.id}); return res.status(201).json({check: row});
}));
app.patch('/api/admin/assessments/:id', requireAuth, requireRole('ADMIN', 'REVIEWER'), validate(z.object({status: z.enum(['SUBMITTED', 'DOCUMENTS_REQUESTED', 'UNDER_REVIEW', 'INFORMATION_NEEDED', 'COMPLETED', 'PROFESSIONAL_REVIEW_REQUIRED', 'DECLINED']).optional(), reviewerNotes: z.string().max(5000).optional(), reportNotes: z.string().max(10000).optional(), assignedReviewerId: z.string().uuid().nullable().optional()}), async (req, res, data) => {
  const actor = currentUser(req); const existing = await prisma.propertyAssessment.findUnique({where: {id: req.params.id}}); if (!existing || (actor.role === 'REVIEWER' && existing.assignedReviewerId !== actor.id)) return res.status(404).json({message: 'Assessment not found.'});
  if (actor.role === 'REVIEWER' && data.assignedReviewerId !== undefined) return res.status(403).json({message: 'Only administrators can change reviewer assignments.'});
  if (data.assignedReviewerId && !(await prisma.user.findFirst({where: {id: data.assignedReviewerId, role: 'REVIEWER', isSuspended: false}}))) return res.status(400).json({message: 'Select an active reviewer account.'});
  const row = await prisma.propertyAssessment.update({where: {id: req.params.id}, data: {...data, completedAt: data.status === 'COMPLETED' ? new Date() : undefined}}); await audit(req, actor.id, 'ASSESSMENT_UPDATED', 'PropertyAssessment', row.id); if (data.status) await notifySafely(row.email, 'Property assessment status updated', `Your property assessment ${row.reference} status is now ${row.status}. Sign in to view recorded findings. This is not a guarantee of title or legality.`); return res.json({assessment: row});
}));

app.get('/api/admin/cases/:id', requireAuth, requireRole('ADMIN', 'REVIEWER'), asyncRoute(async (req, res) => {
  const row = await prisma.disputeCase.findUnique({where: {id: req.params.id}, include: {messages: {orderBy: {createdAt: 'asc'}, include: {user: {select: {name: true, role: true}}}}, milestones: {orderBy: {dueAt: 'asc'}}, statusEvents: {orderBy: {createdAt: 'asc'}}, documents: {where: {deletedAt: null}}}}); if (!row) return res.status(404).json({message: 'Case not found.'});
  const user = currentUser(req); if (user.role === 'REVIEWER' && row.assignedReviewerId !== user.id) return res.status(404).json({message: 'Case not found.'}); return res.json({case: row});
}));
app.patch('/api/admin/cases/:id', requireAuth, requireRole('ADMIN', 'REVIEWER'), validate(z.object({status: z.enum(['SUBMITTED', 'INITIAL_SCREENING', 'ADDITIONAL_INFORMATION_REQUIRED', 'CONFLICT_CHECK', 'PROFESSIONAL_REVIEW', 'SCOPE_AND_FEE_APPROVAL', 'AWAITING_PAYMENT', 'ACCEPTED_FOR_SERVICE', 'IN_PROGRESS', 'AWAITING_USER_RESPONSE', 'OUTCOME_RECORDED', 'CLOSED', 'DECLINED', 'REFERRED_ELSEWHERE']).optional(), feePaise: z.number().int().min(0).max(100000000).optional(), reviewerNotes: z.string().max(8000).optional(), assignedReviewerId: z.string().uuid().nullable().optional()}), async (req, res, data) => {
  const user = currentUser(req);
  const existing = await prisma.disputeCase.findUnique({where: {id: req.params.id}});
  if (!existing || (user.role === 'REVIEWER' && existing.assignedReviewerId !== user.id)) return res.status(404).json({message: 'Case not found.'});
  if (user.role === 'REVIEWER' && (data.assignedReviewerId !== undefined || data.feePaise !== undefined || data.status === 'AWAITING_PAYMENT')) return res.status(403).json({message: 'Only administrators can change assignments, approve service fees, or release a case for payment.'});
  if (data.assignedReviewerId && !(await prisma.user.findFirst({where: {id: data.assignedReviewerId, role: 'REVIEWER', isSuspended: false}}))) return res.status(400).json({message: 'Select an active reviewer account.'});
  if (data.feePaise !== undefined && data.feePaise !== existing.feePaise) {
    if (existing.paymentStatus === 'PAID' || existing.paymentStatus === 'REFUND_PENDING' || existing.paymentStatus === 'REFUNDED') return res.status(409).json({message: 'A fee cannot be changed after payment or refund processing has started.'});
    const activeOrder = await prisma.payment.findFirst({where: {disputeCaseId: existing.id, status: {in: ['CREATING', 'CREATED', 'PENDING_CAPTURE']}}});
    if (activeOrder) return res.status(409).json({message: 'The fee cannot be changed while a payment order is active. Resolve the pending order first.'});
    if (data.feePaise > 0 && !data.status) return res.status(400).json({message: 'Set the agreed fee and explicitly set status to AWAITING_PAYMENT only after scope and fee approval.'});
  }
  if (data.status === 'AWAITING_PAYMENT' && (data.feePaise ?? existing.feePaise) <= 0) return res.status(400).json({message: 'A positive agreed service fee is required before awaiting payment.'});
  const row = await prisma.$transaction(async tx => {
    const updated = await tx.disputeCase.update({where: {id: req.params.id}, data});
    if (data.status && data.status !== existing.status) await tx.caseStatusEvent.create({data: {disputeCaseId: updated.id, fromStatus: existing.status, toStatus: data.status, actorId: user.id, note: 'Status updated by staff.'}});
    return updated;
  }, {isolationLevel: Prisma.TransactionIsolationLevel.Serializable});
  await audit(req, user.id, 'DISPUTE_CASE_UPDATED', 'DisputeCase', row.id, {status: row.status, feePaise: row.feePaise}); if (data.status) await notifySafely(row.email, 'Dispute case status updated', `Your dispute intake ${row.reference} status is now ${row.status}. This does not guarantee acceptance or a particular outcome.`); return res.json({case: row});
}));
app.post('/api/admin/cases/:id/milestones', requireAuth, requireRole('ADMIN', 'REVIEWER'), validate(z.object({title: z.string().trim().min(2).max(200), description: z.string().max(3000).optional(), dueAt: z.string().datetime().optional(), status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).default('PLANNED')}), async (req, res, data) => {
  const actor = currentUser(req); const c = await prisma.disputeCase.findUnique({where: {id: req.params.id}, select: {id: true, assignedReviewerId: true}});
  if (!c || (actor.role === 'REVIEWER' && c.assignedReviewerId !== actor.id)) return res.status(404).json({message: 'Case not found.'});
  const milestone = await prisma.caseMilestone.create({data: {disputeCaseId: c.id, title: data.title, description: data.description, dueAt: data.dueAt ? new Date(data.dueAt) : undefined, status: data.status, completedAt: data.status === 'COMPLETED' ? new Date() : undefined, createdById: actor.id}});
  await audit(req, actor.id, 'CASE_MILESTONE_CREATED', 'DisputeCase', c.id, {milestoneId: milestone.id});
  const caseRow = await prisma.disputeCase.findUnique({where: {id: c.id}, select: {email: true, reference: true}});
  if (caseRow) await notifySafely(caseRow.email, 'Dispute case milestone updated', `A milestone for your case ${caseRow.reference} was recorded. Sign in to view the details.`);
  return res.status(201).json({milestone});
}));
app.patch('/api/admin/case-milestones/:id', requireAuth, requireRole('ADMIN', 'REVIEWER'), validate(z.object({title: z.string().trim().min(2).max(200).optional(), description: z.string().max(3000).nullable().optional(), dueAt: z.string().datetime().nullable().optional(), status: z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional()}), async (req, res, data) => {
  const actor = currentUser(req); const existing = await prisma.caseMilestone.findUnique({where: {id: req.params.id}, include: {disputeCase: {select: {id: true, assignedReviewerId: true, email: true, reference: true}}}});
  if (!existing || (actor.role === 'REVIEWER' && existing.disputeCase.assignedReviewerId !== actor.id)) return res.status(404).json({message: 'Milestone not found.'});
  const update: Prisma.CaseMilestoneUpdateInput = {...data, dueAt: data.dueAt === undefined ? undefined : data.dueAt ? new Date(data.dueAt) : null, completedAt: data.status === 'COMPLETED' ? new Date() : data.status && data.status !== 'COMPLETED' ? null : undefined};
  const milestone = await prisma.caseMilestone.update({where: {id: existing.id}, data: update});
  await audit(req, actor.id, 'CASE_MILESTONE_UPDATED', 'DisputeCase', existing.disputeCase.id, {milestoneId: milestone.id, status: milestone.status});
  if (data.status) await notifySafely(existing.disputeCase.email, 'Dispute case milestone updated', `A milestone for your case ${existing.disputeCase.reference} changed to ${milestone.status}. Sign in to view the details.`);
  return res.json({milestone});
}));

app.post('/api/admin/cases/:id/messages', requireAuth, requireRole('ADMIN', 'REVIEWER'), validate(z.object({body: z.string().trim().min(1).max(4000), isInternal: z.boolean().default(false)}), async (req, res, data) => {
  const user = currentUser(req); const c = await prisma.disputeCase.findUnique({where: {id: req.params.id}, select: {id: true, assignedReviewerId: true}});
  if (!c || (user.role === 'REVIEWER' && c.assignedReviewerId !== user.id)) return res.status(404).json({message: 'Case not found.'});
  const message = await prisma.caseMessage.create({data: {disputeCaseId: c.id, userId: user.id, senderRole: user.role, body: data.body, isInternal: data.isInternal}}); await audit(req, user.id, 'CASE_MESSAGE_ADDED_BY_STAFF', 'DisputeCase', c.id); return res.status(201).json({message});
}));

app.post('/api/admin/payments/:id/refund', requireAuth, requireRole('ADMIN'), validate(z.object({amountPaise: z.number().int().positive().optional(), reason: z.string().max(1000).optional()}), async (req, res, data) => {
  if (!razorpayConfigured()) return res.status(503).json({message: 'Razorpay is not configured for live/sandbox refund calls.'});
  const reservation = await prisma.$transaction(async tx => {
    const payment = await tx.payment.findUnique({where: {id: req.params.id}});
    if (!payment || payment.status !== 'CAPTURED' || !payment.gatewayPaymentId) throw new HttpError(409, 'Only verified captured payments can be refunded.');
    const amountPaise = data.amountPaise ?? payment.amountPaise;
    const priorRefunds = await tx.refund.aggregate({where: {paymentId: payment.id, status: {in: ['PENDING', 'PROCESSING', 'PROCESSED', 'NEEDS_RECONCILIATION']}}, _sum: {amountPaise: true}});
    if (amountPaise + (priorRefunds._sum.amountPaise || 0) > payment.amountPaise) throw new HttpError(400, 'Refund amount would exceed the captured payment total after prior refunds.');
    const refund = await tx.refund.create({data: {paymentId: payment.id, amountPaise, reason: data.reason, requestedById: currentUser(req).id, status: 'PROCESSING'}});
    return {refund, payment};
  }, {isolationLevel: Prisma.TransactionIsolationLevel.Serializable});
  try {
    const gatewayRefund = await razorpayRequest<{id: string; status: string}>(`/payments/${encodeURIComponent(reservation.payment.gatewayPaymentId!)}/refund`, {method: 'POST', body: JSON.stringify({amount: reservation.refund.amountPaise, notes: {svuRefundId: reservation.refund.id, reason: safeText(data.reason, 200)}})});
    const updated = await prisma.refund.update({where: {id: reservation.refund.id}, data: {gatewayRefundId: gatewayRefund.id, status: gatewayRefund.status === 'processed' ? 'PROCESSED' : 'PENDING'}});
    if (reservation.payment.bookingId) await prisma.bookingRequest.update({where: {id: reservation.payment.bookingId}, data: {paymentStatus: 'REFUND_PENDING'}});
    if (reservation.payment.disputeCaseId) await prisma.disputeCase.update({where: {id: reservation.payment.disputeCaseId}, data: {paymentStatus: 'REFUND_PENDING'}});
    await audit(req, currentUser(req).id, 'REFUND_INITIATED', 'Payment', reservation.payment.id, {refundId: updated.id, amountPaise: reservation.refund.amountPaise});
    return res.status(201).json({refund: updated});
  } catch (error) {
    // Network timeouts / gateway 5xx responses are ambiguous: Razorpay may have accepted the refund.
    // Reserve the amount until an operator reconciles it against the Razorpay dashboard; never auto-retry it.
    const ambiguous = !(error instanceof HttpError) || error.status >= 500;
    await prisma.refund.update({where: {id: reservation.refund.id}, data: {status: ambiguous ? 'NEEDS_RECONCILIATION' : 'FAILED'}});
    throw error;
  }
}));

app.get('/api/admin/refunds', requireAuth, requireRole('ADMIN'), asyncRoute(async (_req, res) => {
  const refunds = await prisma.refund.findMany({orderBy: {createdAt: 'desc'}, take: 200, include: {payment: {include: {user: {select: {name: true, email: true}}, booking: {select: {reference: true, service: true}}, disputeCase: {select: {reference: true, category: true}}}}}});
  return res.json({refunds});
}));
app.post('/api/admin/refunds/:id/process', requireAuth, requireRole('ADMIN'), asyncRoute(async (req, res) => {
  if (!razorpayConfigured()) return res.status(503).json({message: 'Razorpay is not configured for refund processing.'});
  const refund = await prisma.$transaction(async tx => {
    const candidate = await tx.refund.findUnique({where: {id: req.params.id}, include: {payment: true}});
    if (!candidate || !['PENDING', 'FAILED'].includes(candidate.status)) throw new HttpError(409, 'Only pending/failed refund requests can be submitted for processing.');
    if (candidate.payment.status !== 'CAPTURED' || !candidate.payment.gatewayPaymentId) throw new HttpError(409, 'The linked payment is not verified as captured.');
    const reserved = await tx.refund.aggregate({where: {paymentId: candidate.paymentId, id: {not: candidate.id}, status: {in: ['PENDING', 'PROCESSING', 'PROCESSED', 'NEEDS_RECONCILIATION']}}, _sum: {amountPaise: true}});
    if ((reserved._sum.amountPaise || 0) + candidate.amountPaise > candidate.payment.amountPaise) throw new HttpError(409, 'Other refunds already consume the available refundable balance.');
    const claimed = await tx.refund.updateMany({where: {id: candidate.id, status: {in: ['PENDING', 'FAILED']}}, data: {status: 'PROCESSING'}});
    if (claimed.count !== 1) throw new HttpError(409, 'This refund was already claimed by another administrator. Refresh to see its status.');
    return candidate;
  }, {isolationLevel: Prisma.TransactionIsolationLevel.Serializable});
  try {
    const remote = await razorpayRequest<{id: string; status: string}>(`/payments/${encodeURIComponent(refund.payment.gatewayPaymentId!)}/refund`, {method: 'POST', body: JSON.stringify({amount: refund.amountPaise, notes: {svuRefundId: refund.id, reason: safeText(refund.reason, 200)}})});
    const saved = await prisma.refund.update({where: {id: refund.id}, data: {gatewayRefundId: remote.id, status: remote.status === 'processed' ? 'PROCESSED' : 'PENDING'}});
    await audit(req, currentUser(req).id, 'REFUND_SUBMITTED_TO_GATEWAY', 'Refund', refund.id, {gatewayRefundId: remote.id, amountPaise: refund.amountPaise});
    return res.json({refund: saved, message: 'Refund submitted to Razorpay. Final state is reconciled from signed gateway webhook events.'});
  } catch (error) {
    const ambiguous = !(error instanceof HttpError) || error.status >= 500;
    await prisma.refund.update({where: {id: refund.id}, data: {status: ambiguous ? 'NEEDS_RECONCILIATION' : 'FAILED'}});
    throw error;
  }
}));

app.post('/api/admin/refunds/:id/reconcile', requireAuth, requireRole('ADMIN'), validate(z.object({gatewayRefundId: z.string().trim().min(4).max(150)}), async (req, res, data) => {
  const refund = await prisma.refund.findUnique({where: {id: req.params.id}, include: {payment: true}});
  if (!refund || refund.status !== 'NEEDS_RECONCILIATION') return res.status(409).json({message: 'Only refunds marked as needing reconciliation can use this workflow.'});
  if (!refund.payment.gatewayPaymentId) return res.status(409).json({message: 'The linked payment has no verified gateway payment ID.'});
  const remote = await razorpayRequest<{id: string; payment_id: string; amount: number; status: string}>('/refunds/' + encodeURIComponent(data.gatewayRefundId), {method: 'GET'});
  if (remote.id !== data.gatewayRefundId || remote.payment_id !== refund.payment.gatewayPaymentId || remote.amount !== refund.amountPaise) return res.status(409).json({message: 'Gateway refund ID, payment ID or amount does not match the reserved local refund. No record was changed.'});
  const status = remote.status === 'processed' ? 'PROCESSED' : ['failed', 'rejected'].includes(remote.status) ? 'FAILED' : 'PENDING';
  const updated = await prisma.refund.update({where: {id: refund.id}, data: {gatewayRefundId: remote.id, status}});
  if (status === 'PROCESSED') {
    const total = await prisma.refund.aggregate({where: {paymentId: refund.paymentId, status: 'PROCESSED'}, _sum: {amountPaise: true}});
    if ((total._sum.amountPaise || 0) >= refund.payment.amountPaise) {
      if (refund.payment.bookingId) await prisma.bookingRequest.update({where: {id: refund.payment.bookingId}, data: {paymentStatus: 'REFUNDED', status: 'CANCELLED'}});
      if (refund.payment.disputeCaseId) await prisma.disputeCase.update({where: {id: refund.payment.disputeCaseId}, data: {paymentStatus: 'REFUNDED'}});
    }
  }
  await audit(req, currentUser(req).id, 'REFUND_RECONCILED_WITH_GATEWAY', 'Refund', refund.id, {gatewayRefundId: remote.id, status});
  return res.json({refund: updated, message: `Gateway refund reconciled with reported status: ${status}.`});
}));

app.post('/api/admin/refunds/:id/mark-processed', requireAuth, requireRole('ADMIN'), asyncRoute(async (_req, res) => {
  return res.status(409).json({message: 'Refund status cannot be marked processed manually. Process it through Razorpay and wait for the verified gateway response/webhook.'});
}));

app.get('/api/admin/articles', requireAuth, requireRole('ADMIN'), asyncRoute(async (_req, res) => res.json({articles: await prisma.article.findMany({orderBy: {updatedAt: 'desc'}, take: 200})})));
const articleSchema = z.object({title: z.string().trim().min(4).max(200), slug: z.string().trim().min(3).max(180).regex(/^[a-z0-9-]+$/), excerpt: z.string().trim().min(10).max(500), bodyMarkdown: z.string().trim().min(20).max(50000), category: z.string().trim().min(2).max(80), tags: z.array(z.string().max(40)).max(20).default([]), readingMinutes: z.number().int().min(1).max(120).default(4), status: z.enum(['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED']).default('DRAFT'), lastReviewedAt: z.string().datetime().optional()});
app.post('/api/admin/articles', requireAuth, requireRole('ADMIN'), validate(articleSchema, async (req, res, data) => { const row = await prisma.article.create({data: {...data, lastReviewedAt: data.lastReviewedAt ? new Date(data.lastReviewedAt) : undefined}}); await audit(req, currentUser(req).id, 'ARTICLE_CREATED', 'Article', row.id); return res.status(201).json({article: row}); }));
app.patch('/api/admin/articles/:id', requireAuth, requireRole('ADMIN'), validate(articleSchema.partial(), async (req, res, data) => { const row = await prisma.article.update({where: {id: req.params.id}, data: {...data, lastReviewedAt: data.lastReviewedAt ? new Date(data.lastReviewedAt) : undefined}}); await audit(req, currentUser(req).id, 'ARTICLE_UPDATED', 'Article', row.id); return res.json({article: row}); }));

// A first administrator can be bootstrapped from server-only environment variables. Never ship defaults.
async function bootstrapAdministrator() {
  const email = process.env.ADMIN_INITIAL_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_INITIAL_PASSWORD;
  if (!email || !password || email.endsWith('@example.com') || password.includes('CHANGE-THIS')) return;
  if (password.length < 16) { console.error('ADMIN_INITIAL_PASSWORD must be at least 16 characters; administrator bootstrap skipped.'); return; }
  const existing = await prisma.user.findUnique({where: {email}});
  if (existing) { console.info('Initial administrator email already exists; bootstrap will not alter its role or password.'); return; }
  await prisma.user.create({data: {name: process.env.ADMIN_INITIAL_NAME || 'SVU Administrator', email, passwordHash: await hashPassword(password), role: 'ADMIN', emailVerifiedAt: new Date()}});
  console.info('Initial administrator account created from environment configuration.');
}

const adminModels = {contacts: prisma.contactEnquiry, assessments: prisma.propertyAssessment, bookings: prisma.bookingRequest, disputes: prisma.disputeCase} as const;
const anyStatus = z.enum(['NEW','IN_REVIEW','NEEDS_INFORMATION','CONTACTED','ACCEPTED','IN_PROGRESS','COMPLETED','CLOSED','DECLINED','CANCELLED','SUBMITTED','DOCUMENTS_REQUESTED','UNDER_REVIEW','INFORMATION_NEEDED','PROFESSIONAL_REVIEW_REQUIRED','REQUESTED','AWAITING_PAYMENT','CONFIRMED','PAYMENT_RECEIVED','CANCEL_REQUESTED','INITIAL_SCREENING','ADDITIONAL_INFORMATION_REQUIRED','CONFLICT_CHECK','PROFESSIONAL_REVIEW','SCOPE_AND_FEE_APPROVAL','ACCEPTED_FOR_SERVICE','AWAITING_USER_RESPONSE','OUTCOME_RECORDED','REFERRED_ELSEWHERE']);
app.patch('/api/admin/:kind/:id', requireAuth, requireRole('ADMIN'), validate(z.object({status: anyStatus}), async (req, res, data) => {
  const kind = req.params.kind as keyof typeof adminModels;
  if (!Object.prototype.hasOwnProperty.call(adminModels, kind)) return res.status(404).json({message: 'Unknown record type.'});
  if (kind === 'assessments' || kind === 'disputes') return res.status(400).json({message: 'Use the dedicated workflow endpoint so review fields and case history are preserved.'});
  const allowedStatuses: Record<keyof typeof adminModels, string[]> = {
    contacts: ['NEW', 'IN_REVIEW', 'CONTACTED', 'CLOSED'],
    assessments: ['SUBMITTED', 'DOCUMENTS_REQUESTED', 'UNDER_REVIEW', 'INFORMATION_NEEDED', 'COMPLETED', 'PROFESSIONAL_REVIEW_REQUIRED', 'DECLINED'],
    bookings: ['REQUESTED', 'AWAITING_PAYMENT', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DECLINED', 'PAYMENT_RECEIVED', 'CANCEL_REQUESTED'],
    disputes: ['SUBMITTED', 'INITIAL_SCREENING', 'ADDITIONAL_INFORMATION_REQUIRED', 'CONFLICT_CHECK', 'PROFESSIONAL_REVIEW', 'SCOPE_AND_FEE_APPROVAL', 'AWAITING_PAYMENT', 'ACCEPTED_FOR_SERVICE', 'IN_PROGRESS', 'AWAITING_USER_RESPONSE', 'OUTCOME_RECORDED', 'CLOSED', 'DECLINED', 'REFERRED_ELSEWHERE'],
  };
  if (!allowedStatuses[kind].includes(data.status)) return res.status(400).json({message: `Status ${data.status} is not valid for ${kind}.`});
  if (kind === 'bookings' && data.status === 'CANCELLED') {
    const booking = await prisma.bookingRequest.findUnique({where: {id: req.params.id}});
    if (!booking) return res.status(404).json({message: 'Booking not found.'});
    await prisma.$transaction(async tx => {
      await tx.bookingRequest.update({where: {id: booking.id}, data: {status: 'CANCELLED', cancelledAt: new Date()}});
      if (booking.slotId && !['PAID','REFUND_PENDING'].includes(booking.paymentStatus)) await tx.availabilitySlot.update({where: {id: booking.slotId}, data: {isBooked: false}});
    });
    await audit(req, currentUser(req).id, 'ADMIN_BOOKING_CANCELLED', 'BookingRequest', booking.id); return res.json({id: booking.id, status: 'CANCELLED'});
  }
  const model = adminModels[kind] as any;
  const row = await model.update({where: {id: req.params.id}, data: {status: data.status}});
  await audit(req, currentUser(req).id, 'ADMIN_STATUS_UPDATED', kind, row.id, {status: data.status});
  if (kind === 'assessments') { const r = row as {email?: string; reference?: string; status?: string}; if (r.email) await notifySafely(r.email, 'Property assessment status updated', `Your property assessment ${r.reference || ''} status is now ${r.status}. Sign in to view the recorded information. This is a workflow update, not a title guarantee.`); }
  if (kind === 'bookings') { const r = row as {email?: string; reference?: string; status?: string}; if (r.email) await notifySafely(r.email, 'Consultation status updated', `Your request ${r.reference || ''} status is now ${r.status}. Sign in to view your appointment and payment state.`); }
  if (kind === 'disputes') { const r = row as {email?: string; reference?: string; status?: string}; if (r.email) await notifySafely(r.email, 'Dispute case status updated', `Your dispute intake ${r.reference || ''} status is now ${r.status}. This update does not guarantee acceptance, arbitrability or a particular outcome.`); }
  return res.json({id: row.id, status: row.status, updatedAt: row.updatedAt});
}));

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return res.status(err.status).json({message: err.message});
  if (err instanceof z.ZodError) return res.status(400).json({message: 'Invalid input.'});
  const code = (err as any)?.code;
  if (code === 'P2002') return res.status(409).json({message: 'A record with this information already exists. Refresh and try again.'});
  if (code === 'P2025') return res.status(404).json({message: 'The requested record was not found.'});
  if (code === 'P2034') return res.status(409).json({message: 'A concurrent update occurred. Please retry the request.'});
  console.error('API error:', err instanceof Error ? err.message : 'unknown error');
  return res.status(500).json({message: 'A server error occurred. Please try again later.'});
});

// Export Express for the Next.js API catch-all route. Do not call app.listen here.
export {app};
export default app;
