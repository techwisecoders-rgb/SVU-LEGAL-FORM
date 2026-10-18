import Link from 'next/link';
import { ArrowUpRight, ChevronDown, FileCheck2, FileSearch, Landmark, MapPinned, Scale, ShieldCheck, BookOpen, type LucideIcon } from 'lucide-react';
import LineTrail from './LineTrail';
import MobileMenu from './MobileMenu';

const menuGroups: { title: string; items: [string, string, LucideIcon][] }[] = [
  { title: 'PROPERTY CHECKS', items: [['Land due diligence','/services/land-due-diligence',FileSearch],['Title & ownership','/services/property-title-verification',ShieldCheck],['Plots & layouts','/services/residential-plots-layout-verification',MapPinned],['Agricultural land','/services/agricultural-land',Landmark]] },
  { title: 'DOCUMENTS & TRANSACTIONS', items: [['Sale deed & agreement','/services/agreement-review',FileCheck2],['Apartments & villas','/services/residential-property',ShieldCheck],['Inherited property','/services/inherited-property-partition-guidance',FileCheck2],['Commercial property','/services/commercial-property',Landmark]] },
  { title: 'DISPUTES & GUIDANCE', items: [['Property dispute assessment','/services/property-disputes',Scale],['Arbitration support','/arbitration',Scale],['Free knowledge centre','/knowledge',BookOpen],['Book a consultation','/book',ArrowUpRight]] },
];
export function Header(){
  return <header className="svu-site-header"><div className="container svu-header-row">
    <Link href="/" className="svu-brand" aria-label="SVU Developers Private Limited home"><div className="svu-brand-mark">S</div><div><div className="svu-brand-name">SVU DEVELOPERS</div><div className="svu-brand-sub">PRIVATE LIMITED</div></div></Link>
    <nav className="desktop-nav svu-desktop-nav" aria-label="Primary navigation">
      <Link className="navlink" href="/about">About</Link>
      <div className="navgroup svu-navgroup"><Link className="navlink svu-services-trigger" href="/services">Services <ChevronDown size={12}/></Link>
        <div className="mega svu-mega-menu"><div className="svu-mega-heading"><div><span>HOW WE CAN HELP</span><h3 className="serif">Find the right place to start.</h3></div><Link href="/services">All services <ArrowUpRight size={14}/></Link></div>
          <div className="svu-mega-grid">{menuGroups.map(group=><div className="svu-mega-group" key={group.title}><div className="svu-mega-group-title">{group.title}</div>{group.items.map(([label,href,ItemIcon])=><Link className="svu-mega-link" href={href} key={href}><span><ItemIcon size={16}/></span><b>{label}</b><ArrowUpRight size={12}/></Link>)}</div>)}</div>
          <div className="svu-mega-bottom"><span><ShieldCheck size={14}/> Clear scope before engagement</span><Link href="/property-check">Build a property brief <ArrowUpRight size={14}/></Link></div>
        </div>
      </div>
      <Link className="navlink" href="/property-check">Property checks</Link>
      <Link className="navlink" href="/knowledge">Free legal help</Link>
      <Link className="navlink" href="/arbitration">Disputes</Link>
      <Link className="navlink" href="/articles">Articles</Link>
    </nav>
    <div className="svu-header-actions"><Link className="navlink account-link" href="/login">Sign in</Link><Link className="btn desktop-book" href="/book">Book consultation <ArrowUpRight size={14}/></Link><MobileMenu/></div>
  </div>
  <div className="svu-header-subbar"><div className="container"><span>PROPERTY CLARITY. BETTER DECISIONS.</span><span>LAND · DOCUMENTS · DISPUTE SUPPORT</span><Link href="/property-check">Start with a property check <ArrowUpRight size={12}/></Link></div></div>
  <style>{`
    .svu-site-header{background:#101b2b;color:#f7f5ef;position:sticky;top:0;z-index:50;border-bottom:1px solid #ffffff18}
    .svu-header-row{height:78px;display:flex;align-items:center;justify-content:space-between;gap:22px}
    .svu-brand{display:flex;align-items:center;gap:11px;min-width:190px;flex-shrink:0}
    .svu-brand-mark{width:38px;height:38px;border:1px solid #c8a96b;display:grid;place-items:center;color:#d8bb7e;font-family:Georgia,serif;font-size:21px;position:relative}
    .svu-brand-mark:after{content:'';position:absolute;inset:4px;border:1px solid #c8a96b3b}
    .svu-brand-name{font-size:12px;letter-spacing:.09em;font-weight:700}
    .svu-brand-sub{font-size:8px;letter-spacing:.21em;color:#c8a96b;margin-top:5px}
    .svu-desktop-nav{display:flex;align-items:center;gap:20px}
    .svu-desktop-nav .navlink{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-size:10px;letter-spacing:.02em}
    .svu-navgroup{position:relative}
    .svu-services-trigger svg{transition:transform .2s}
    .svu-navgroup:hover .svu-services-trigger svg,.svu-navgroup:focus-within .svu-services-trigger svg{transform:rotate(180deg)}
    .svu-mega-menu{display:none;position:absolute;top:100%;left:-145px;width:760px;max-width:calc(100vw - 36px);padding:23px 25px 0;background:#f8f6ef;color:#172538;border:1px solid #d8c89e;box-shadow:0 24px 60px #0004;white-space:normal}
    .svu-mega-heading{display:flex;align-items:center;justify-content:space-between;gap:20px;padding-bottom:17px;border-bottom:1px solid #ded8ca}
    .svu-mega-heading span{font-size:8px;letter-spacing:.16em;font-weight:700;color:#a1824a}
    .svu-mega-heading h3{font-weight:400;font-size:24px;margin:7px 0 0}
    .svu-mega-heading>a,.svu-mega-bottom>a{display:inline-flex;align-items:center;gap:7px;color:#2b3948;font-size:9px;font-weight:700;border-bottom:1px solid #c8a96b;padding-bottom:6px;white-space:nowrap}
    .svu-mega-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:23px;padding:21px 0}
    .svu-mega-group-title{font-size:7px;font-weight:700;letter-spacing:.12em;color:#96918a;margin-bottom:9px}
    .svu-mega-link{display:grid;grid-template-columns:27px 1fr 12px;align-items:center;gap:7px;padding:10px 0;border-bottom:1px solid #ebe6dc;color:#273444;font-size:9px;line-height:1.4}
    .svu-mega-link>span{height:26px;width:26px;border:1px solid #e0d5bb;display:grid;place-items:center;color:#9c7d43}
    .svu-mega-link>svg{color:#a1824a;opacity:0;transition:opacity .18s,transform .18s}
    .svu-mega-link:hover{color:#96723a}.svu-mega-link:hover>svg{opacity:1;transform:translate(2px,-2px)}
    .svu-mega-bottom{display:flex;align-items:center;justify-content:space-between;gap:15px;margin:0 -25px;padding:13px 25px;background:#eeece4;font-size:8px}
    .svu-mega-bottom>span{display:flex;align-items:center;gap:7px;color:#7a8288}.svu-mega-bottom>span svg{color:#9c7d43}
    .svu-navgroup:hover .mega,.svu-navgroup:focus-within .mega{display:block!important;animation:svuMegaIn .16s ease-out}
    @keyframes svuMegaIn{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
    .svu-header-actions{display:flex;align-items:center;gap:13px;flex-shrink:0}
    .svu-header-actions .btn{display:inline-flex;align-items:center;padding:12px 13px;font-size:9px;white-space:nowrap}
    .svu-header-subbar{border-top:1px solid #ffffff13;background:#0d1725}
    .svu-header-subbar>.container{height:27px;display:flex;align-items:center;gap:18px;font-size:7px;letter-spacing:.15em;color:#a9b3bf}
    .svu-header-subbar>div>span:first-child{color:#d1b575}.svu-header-subbar>div>span:nth-child(2){margin-left:auto}
    .svu-header-subbar a{display:flex;align-items:center;gap:6px;color:#d4b878;white-space:nowrap}
    @media(max-width:1110px){.svu-desktop-nav{gap:12px}.svu-brand{min-width:170px}.svu-brand-name{font-size:11px}.svu-header-actions{gap:9px}}
    @media(max-width:980px){.svu-desktop-nav{gap:10px}.svu-desktop-nav .navlink{font-size:9px}.svu-header-row{gap:13px}.svu-brand{min-width:155px}}
    @media(max-width:760px){.svu-header-row{height:72px}.svu-desktop-nav{display:none}.svu-header-subbar>div>span:first-child,.svu-header-subbar>div>span:nth-child(2){display:none}.svu-header-subbar>.container{justify-content:space-between}.svu-header-actions .desktop-book,.svu-header-actions .account-link{display:none!important}}
    @media(prefers-reduced-motion:reduce){.svu-navgroup:hover .mega,.svu-navgroup:focus-within .mega{animation:none}}
  `}</style></header>
}

export function Footer(){return <footer style={{background:'#101b2b',color:'#f7f5ef',padding:'64px 0 24px',marginTop:0}}><div className="container"><div style={{display:'grid',gridTemplateColumns:'2fr 1fr 1fr 1fr',gap:32}} className="footer-grid"><div><div className="eyebrow">Property clarity. Better decisions.</div><h3 className="serif" style={{fontSize:30,fontWeight:400,lineHeight:1.2,maxWidth:340}}>Understand the documents before you make the decision.</h3><p style={{color:'#aeb6c1',fontSize:13,lineHeight:1.8,maxWidth:350}}>Structured property information, document review coordination and dispute-related support for real estate matters in India.</p></div><div><b style={{fontSize:12}}>Explore</b><Link className="footer-link" href="/about">About us</Link><Link className="footer-link" href="/services">Services</Link><Link className="footer-link" href="/knowledge">Free knowledge centre</Link><Link className="footer-link" href="/articles">Articles & guides</Link></div><div><b style={{fontSize:12}}>Get support</b><Link className="footer-link" href="/property-check">Property legal check</Link><Link className="footer-link" href="/book">Book a consultation</Link><Link className="footer-link" href="/submit-dispute">Submit a dispute</Link><Link className="footer-link" href="/contact">Contact</Link><Link className="footer-link" href="/login">Sign in / My account</Link></div><div><b style={{fontSize:12}}>Important</b><Link className="footer-link" href="/privacy">Privacy policy</Link><Link className="footer-link" href="/terms">Terms & conditions</Link><Link className="footer-link" href="/disclaimer">Legal disclaimer</Link><Link className="footer-link" href="/refund-policy">Refund policy</Link></div></div><div className="line" style={{margin:'42px 0 20px'}}/><div style={{display:'flex',justifyContent:'space-between',gap:18,flexWrap:'wrap',fontSize:10,color:'#aeb6c1',lineHeight:1.7}}><span>© {new Date().getFullYear()} SVU Developers Private Limited. All rights reserved.</span><span>Website information is educational and is not a substitute for case-specific professional advice.</span></div></div><style>{`@media(max-width:700px){.footer-grid{grid-template-columns:1fr 1fr!important}}@media(max-width:760px){.desktop-book{display:none!important}.account-link{display:none!important}}`}</style></footer>}
export default function SiteShell({children}:{children:React.ReactNode}){return <><LineTrail/><Header/>{children}<Footer/></>}
