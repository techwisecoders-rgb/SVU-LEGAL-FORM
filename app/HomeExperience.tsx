'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  ArrowDownRight, ArrowRight, ArrowUpRight, BadgeCheck, BookOpen, Check,
  CheckCircle2, ChevronDown, CircleHelp, ClipboardCheck, FileCheck2, FileSearch,
  Fingerprint, Landmark, LockKeyhole, MapPinned, MessageSquareText,
  Scale, Search, ShieldAlert, ShieldCheck, Sparkles, Workflow,
} from 'lucide-react';

const services = [
  { category: 'Buying property', n: '01', icon: FileSearch, title: 'Land due diligence', desc: 'A structured review plan for title records, revenue material, survey details, land use and transaction-specific questions.', href: '/services/land-due-diligence', tags: 'land plot agricultural purchase records' },
  { category: 'Buying property', n: '02', icon: ShieldCheck, title: 'Title & ownership review', desc: 'Organize the available title chain, seller authority, registered interests and any gaps needing further review.', href: '/services/property-title-verification', tags: 'title ownership sale deed encumbrance' },
  { category: 'Documents', n: '03', icon: FileCheck2, title: 'Agreement & deed review', desc: 'Define a review scope for sale agreements, conveyance documents, payment terms and supporting papers.', href: '/services/agreement-review', tags: 'sale agreement deed contract registration' },
  { category: 'Documents', n: '04', icon: MapPinned, title: 'Plot & layout checks', desc: 'Collect plot identifiers, survey and layout information, approvals and location-specific questions.', href: '/services/residential-plots-layout-verification', tags: 'plot layout survey boundary approval' },
  { category: 'Disputes', n: '05', icon: Scale, title: 'Property dispute assessment', desc: 'Record the facts, involved parties, agreements, notices and key dates before discussing possible routes.', href: '/services/property-disputes', tags: 'dispute litigation mediation arbitration' },
  { category: 'Disputes', n: '06', icon: Landmark, title: 'Agricultural land guidance', desc: 'Identify classification, permitted-use, revenue record and conversion questions relevant to the location.', href: '/services/agricultural-land', tags: 'agriculture farmland land use conversion' },
  { category: 'Documents', n: '07', icon: ClipboardCheck, title: 'Inherited & joint property', desc: 'Prepare a document chronology for succession, co-ownership, family arrangements and partition questions.', href: '/services/inherited-property-partition-guidance', tags: 'inheritance joint ownership family partition' },
  { category: 'Consultations', n: '08', icon: MessageSquareText, title: 'Professional consultation', desc: 'Come prepared with a clear matter summary, key documents and questions for a scoped consultation.', href: '/book', tags: 'consultation lawyer appointment advice' },
];

const questions = [
  { label: 'Seller identity and authority', detail: 'Who is selling, and what documents show their authority to transfer the property?' },
  { label: 'Title chain and past transfers', detail: 'Are relevant deeds and supporting links available for the period that needs review?' },
  { label: 'Recorded encumbrances', detail: 'Have appropriate records been checked for registered interests for a defined period?' },
  { label: 'Land use and approvals', detail: 'Do the classification, permissions and layout details fit the intended use?' },
  { label: 'Survey, extent and boundaries', detail: 'Do the identifying details align across records and any relevant survey material?' },
  { label: 'Agreement and payment terms', detail: 'Are conditions, dates, representations and remedies clearly documented?' },
];

const propertyProfiles: Record<string, { checks: string[]; note: string }> = {
  'Residential plot': { checks: ['Title chain and seller authority', 'Survey number, extent and boundary alignment', 'Layout approval and applicable planning status', 'Access, easements and recorded interests'], note: 'Plot-specific checks vary by state, local authority, layout type and available records.' },
  'Agricultural land': { checks: ['Revenue records and recorded classification', 'Restrictions on transfer or intended use', 'Survey extent, access and boundary evidence', 'Conversion, acquisition or local permissions where applicable'], note: 'Agricultural land rules can be highly state-specific. The plan is a preparation guide, not a legal conclusion.' },
  'Apartment / flat': { checks: ['Land title and development authority documents', 'Building/project approvals relevant to the transaction', 'Sale agreement, undivided share and common-area terms', 'Association, dues and encumbrance questions'], note: 'The applicable checks depend on the project, stage, location and documents supplied.' },
  'Villa / house': { checks: ['Underlying land title and seller authority', 'Building approvals and sanctioned plan questions', 'Property identifiers, boundaries and access', 'Sale deed schedule and outstanding dues'], note: 'Built-property reviews may need both land records and building-related documents.' },
  'Commercial property': { checks: ['Title chain, mortgages and registered interests', 'Permitted use, zoning and applicable approvals', 'Lease, tenancy, occupancy or operating arrangements', 'Transaction agreement, taxes and payment conditions'], note: 'Commercial assets may involve additional use, lease, licence and regulatory checks.' },
  'Inherited / joint property': { checks: ['Deeds and succession/partition documents', 'Identity of persons asserting an interest', 'Authority and consent required for the proposed transfer', 'Existing notices, proceedings or family arrangements'], note: 'The legal position depends on facts, applicable personal law and the complete documentary history.' },
};

const steps = [
  { title: 'Create the property brief', body: 'Tell us the property type, location, transaction stage and questions you need answered.', icon: Fingerprint },
  { title: 'Agree the review scope', body: 'Identify checks, limits, deliverables, fees and expected timing before you proceed.', icon: ClipboardCheck },
  { title: 'Share records privately', body: 'Use the account workflow for authorized documents rather than sending sensitive files in a public enquiry.', icon: LockKeyhole },
  { title: 'Review findings and gaps', body: 'The report records sources reviewed, observations, missing information and recommended next steps.', icon: FileCheck2 },
];

const faqs = [
  ['Does this tool confirm that a property is legally safe?', 'No. It creates an educational preparation plan. A real assessment depends on records, source dates, jurisdiction and qualified professional review. No online checklist can guarantee title or reveal every possible claim.'],
  ['Can I use the platform before I have all documents?', 'Yes. Start by describing what you have and what is missing. The service scope can identify additional documents to request, without treating missing records as verified.'],
  ['Are the legal knowledge resources free?', 'General educational guides and preparation checklists are intended to be free. Individual consultations, document reviews and other scoped services may carry fees shown before commitment.'],
  ['Can every property dispute go to arbitration?', 'No. Suitability depends on the dispute, agreement and applicable law. Submitting a dispute only starts an intake and screening process; it does not mean a matter has been accepted for arbitration.'],
];

export default function HomeExperience() {
  const [profile, setProfile] = useState('Residential plot');
  const [stage, setStage] = useState('Before paying an advance');
  const [region, setRegion] = useState('Andhra Pradesh');
  const [planVisible, setPlanVisible] = useState(false);
  const [serviceFilter, setServiceFilter] = useState('All services');
  const [serviceSearch, setServiceSearch] = useState('');
  const [workspaceTab, setWorkspaceTab] = useState('Checklist');
  const [completedItems, setCompletedItems] = useState<string[]>([]);
  const [activeStep, setActiveStep] = useState(0);

  const filteredServices = useMemo(() => services.filter(service => {
    const matchesFilter = serviceFilter === 'All services' || service.category === serviceFilter;
    const query = serviceSearch.trim().toLowerCase();
    const matchesQuery = !query || `${service.title} ${service.desc} ${service.tags}`.toLowerCase().includes(query);
    return matchesFilter && matchesQuery;
  }), [serviceFilter, serviceSearch]);

  const profileData = propertyProfiles[profile];
  const readyPercent = Math.round((completedItems.length / questions.length) * 100);

  const toggleComplete = (label: string) => setCompletedItems(current => current.includes(label) ? current.filter(item => item !== label) : [...current, label]);

  return <main className="svu-home">
    <section className="svu-hero">
      <div className="svu-hero-grain" aria-hidden="true" />
      <div className="container svu-hero-grid">
        <div className="svu-hero-copy reveal">
          <div className="svu-kicker"><span /> REAL ESTATE LEGAL ADVISORY · INDIA</div>
          <h1 className="serif">The land looks right.<br /><em>Make sure the details do too.</em></h1>
          <p className="svu-hero-lead">Make your next property decision with a clearer view of the documents, permissions and questions that deserve attention before you commit.</p>
          <div className="svu-hero-actions">
            <Link className="btn" href="/property-check">Build a property brief <ArrowUpRight size={16} /></Link>
            <Link className="svu-text-link" href="/knowledge">Explore free legal guidance <ArrowRight size={16} /></Link>
          </div>
          <div className="svu-proof-line"><span><CheckCircle2 size={15} /> Scope before payment</span><span><CheckCircle2 size={15} /> Document-led process</span><span><CheckCircle2 size={15} /> Clear review limitations</span></div>
        </div>
        <div className="svu-hero-art" aria-label="Residential property and example legal review panel">
          <div className="svu-image-frame">
            <div className="svu-image-shade" />
            <div className="svu-image-caption"><span>PROPERTY CLARITY / 01</span><strong className="serif">A considered decision starts before the signature.</strong></div>
          </div>
          <div className="svu-float-tag svu-tag-top"><span className="svu-pulse" /> DOCUMENT-LED REVIEW</div>
          <div className="svu-float-card">
            <div className="svu-float-head"><div><small>YOUR PROPERTY BRIEF</small><strong>Review overview</strong></div><span className="svu-mini-icon"><FileCheck2 size={17} /></span></div>
            <div className="svu-float-row"><span className="svu-dot dot-gold" /> Property details <b>01</b></div>
            <div className="svu-float-row"><span className="svu-dot dot-green" /> Available documents <b>02</b></div>
            <div className="svu-float-row"><span className="svu-dot dot-muted" /> Open questions <b>03</b></div>
            <div className="svu-float-note"><ShieldAlert size={14} /> Sample interface · not a live legal finding</div>
          </div>
          <div className="svu-orbit-label">SVU / PROPERTY INTELLIGENCE</div>
        </div>
      </div>
      <div className="svu-hero-bottom"><div className="container"><span>INFORMED PROPERTY DECISIONS</span><span className="svu-bottom-rule"/><span>LAND · DOCUMENTS · DISPUTES</span><a href="#property-navigator" aria-label="Scroll to property navigator">SCROLL TO EXPLORE <ArrowDownRight size={15}/></a></div></div>
    </section>

    <section className="svu-marquee" aria-label="Areas of assistance"><div className="container"><span>LAND DUE DILIGENCE</span><i>✳</i><span>TITLE & OWNERSHIP</span><i>✳</i><span>DOCUMENT REVIEW</span><i>✳</i><span>PROPERTY DISPUTES</span><i>✳</i><span>CONSULTATIONS</span></div></section>

    <section className="svu-section svu-intro-section">
      <div className="container svu-intro-grid">
        <div className="svu-section-index"><span>01</span><div />THE PROPERTY QUESTION</div>
        <div className="svu-intro-main"><div className="svu-kicker">A good-looking property is only the beginning</div><h2 className="serif">The most important details<br/><em>are often in the records.</em></h2><p>Before money changes hands, it helps to understand the ownership documents, recorded interests, land-use position and agreements that may affect your decision. The right checks depend on the specific property and its jurisdiction.</p><div className="svu-intro-points"><div><span>01</span><strong>Know what is available</strong><p>Separate records in hand from records that still need to be requested.</p></div><div><span>02</span><strong>Know what remains open</strong><p>Make gaps, inconsistencies and follow-up questions visible early.</p></div><div><span>03</span><strong>Know the agreed scope</strong><p>Confirm deliverables, limitations and fees before the work begins.</p></div></div></div>
      </div>
    </section>

    <section className="svu-navigator-section" id="property-navigator">
      <div className="container">
        <div className="svu-section-heading svu-heading-light"><div><div className="svu-kicker">Interactive property navigator</div><h2 className="serif">Start with the property.<br/><em>Build a smarter checklist.</em></h2></div><p>Answer a few basic questions to create a preparation plan that you can take into a scoped review. This is not a title check or a legal risk score.</p></div>
        <div className="svu-navigator-card">
          <div className="svu-navigator-form">
            <div className="svu-step-label"><span>01</span> PROPERTY PROFILE</div>
            <label htmlFor="property-type">What kind of property is it?</label>
            <div className="svu-select-wrap"><select id="property-type" value={profile} onChange={e => { setProfile(e.target.value); setPlanVisible(false); }}>{Object.keys(propertyProfiles).map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={16}/></div>
            <label htmlFor="property-stage">Where are you in the process?</label>
            <div className="svu-select-wrap"><select id="property-stage" value={stage} onChange={e => { setStage(e.target.value); setPlanVisible(false); }}>{['Just exploring','Before paying an advance','Agreement under discussion','Documents already collected','A dispute has arisen'].map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={16}/></div>
            <label htmlFor="property-region">Property state / jurisdiction</label>
            <div className="svu-select-wrap"><select id="property-region" value={region} onChange={e => { setRegion(e.target.value); setPlanVisible(false); }}>{['Andhra Pradesh','Telangana','Tamil Nadu','Karnataka','Maharashtra','Other Indian state / UT'].map(item => <option key={item}>{item}</option>)}</select><ChevronDown size={16}/></div>
            <button type="button" className="btn svu-build-btn" onClick={() => setPlanVisible(true)}>Build my preparation plan <ArrowUpRight size={16}/></button>
            <p className="svu-form-micro"><LockKeyhole size={13}/> No documents are uploaded by this demo tool.</p>
          </div>
          <div className="svu-plan-panel" aria-live="polite">
            {!planVisible ? <><div className="svu-plan-top"><div><small>YOUR PREPARATION PLAN</small><h3 className="serif">A clearer next step,<br/>based on your situation.</h3></div><div className="svu-plan-emblem"><Workflow size={26}/></div></div><div className="svu-plan-preview"><div className="svu-plan-line"><span>01</span><div><b>Understand the property</b><small>Type, location, identifiers and proposed use</small></div><span className="svu-state-pill">START HERE</span></div><div className="svu-plan-line"><span>02</span><div><b>Collect supporting records</b><small>Deeds, relevant extracts, approvals and agreements</small></div></div><div className="svu-plan-line"><span>03</span><div><b>List unanswered questions</b><small>Anything missing or inconsistent stays open</small></div></div></div><div className="svu-plan-footer"><Sparkles size={15}/> Personalize the preparation checklist with three selections.</div></> : <><div className="svu-plan-top"><div><small>PREPARATION PLAN / GENERATED LOCALLY</small><h3 className="serif">{profile}<br/><em>next-step checklist</em></h3></div><div className="svu-plan-emblem"><BadgeCheck size={26}/></div></div><div className="svu-plan-context"><span><MapPinned size={13}/>{region}</span><span><Workflow size={13}/>{stage}</span></div><div className="svu-generated-checks">{profileData.checks.map((item,i)=><div key={item}><span>{String(i+1).padStart(2,'0')}</span><p>{item}</p><Check size={15}/></div>)}</div><p className="svu-plan-disclaimer">{profileData.note} The selected state is recorded as context only; this tool does not search official records or automatically apply state-specific law. Nothing here means a check has been completed.</p><div className="svu-plan-buttons"><button type="button" className="svu-small-text-button" onClick={() => setPlanVisible(false)}>Edit answers</button><Link className="btn" href="/property-check">Continue to request <ArrowUpRight size={15}/></Link></div></>}
          </div>
        </div>
      </div>
    </section>

    <section className="svu-section svu-services-section" id="services">
      <div className="container">
        <div className="svu-section-heading"><div><div className="svu-kicker">Services designed around the question</div><h2 className="serif">The right support for<br/><em>the decision in front of you.</em></h2></div><p>Start with a specific need. Service scope, reviewer availability and actual fees are confirmed before payment.</p></div>
        <div className="svu-service-tools"><div className="svu-service-search"><Search size={17}/><input value={serviceSearch} onChange={e => setServiceSearch(e.target.value)} aria-label="Search services" placeholder="Search by property, document or concern..."/></div><div className="svu-filter-tabs" aria-label="Filter service types">{['All services','Buying property','Documents','Disputes','Consultations'].map(filter => <button key={filter} type="button" className={serviceFilter===filter?'active':''} onClick={() => setServiceFilter(filter)}>{filter}</button>)}</div></div>
        <div className="svu-services-grid">{filteredServices.map(service => { const Icon=service.icon; return <Link href={service.href} key={service.n} className="svu-service-card"><div className="svu-service-card-top"><span>{service.n} / SERVICE</span><Icon size={23} strokeWidth={1.5}/></div><h3 className="serif">{service.title}</h3><p>{service.desc}</p><div className="svu-service-link">Explore service <ArrowUpRight size={15}/></div></Link>; })}{filteredServices.length===0&&<div className="svu-no-results"><CircleHelp size={24}/><b>No matching service found</b><span>Try another search phrase or select all services.</span></div>}</div>
        <div className="svu-services-foot"><span>Not sure where to begin?</span><Link href="/contact">Describe the matter and ask about scope <ArrowRight size={15}/></Link></div>
      </div>
    </section>

    <section className="svu-workspace-section">
      <div className="container svu-workspace-grid">
        <div className="svu-workspace-copy"><div className="svu-section-index svu-index-light"><span>02</span><div/>THE CLIENT WORKSPACE</div><div className="svu-kicker">More than a contact form</div><h2 className="serif">Keep your matter<br/><em>organized in one place.</em></h2><p>A signed-in customer area can bring together property details, agreed checklists, appointment requests, case messages, payment receipts and the latest recorded status—without confusing an administrative status with a verified legal conclusion.</p><div className="svu-workspace-features"><div><FileCheck2 size={18}/><span><b>Document register</b><small>Track requested and supplied files</small></span></div><div><MessageSquareText size={18}/><span><b>Secure case messages</b><small>Keep follow-up questions in context</small></span></div><div><Workflow size={18}/><span><b>Status and milestones</b><small>See the next recorded workflow step</small></span></div></div><Link href="/register" className="btn">Create a customer account <ArrowUpRight size={16}/></Link></div>
        <div className="svu-workspace-demo">
          <div className="svu-demo-window-bar"><div className="svu-window-dots"><i/><i/><i/></div><span>SVU CLIENT WORKSPACE</span><span className="svu-demo-demo-tag">DEMO VIEW</span></div>
          <div className="svu-demo-inside"><div className="svu-demo-welcome"><div><small>PROPERTY MATTER / DEMO-1042</small><h3 className="serif">Plot review workspace</h3><p>Example interface · no real customer data</p></div><div className="svu-demo-status"><span/> IN PROGRESS</div></div>
            <div className="svu-demo-tabs">{['Checklist','Documents','Timeline'].map(tab=><button key={tab} type="button" className={workspaceTab===tab?'selected':''} onClick={() => setWorkspaceTab(tab)}>{tab}</button>)}</div>
            {workspaceTab==='Checklist'&&<div className="svu-demo-checks"><div className="svu-demo-progress"><span>Preparation checklist</span><b>{completedItems.length} of {questions.length} marked</b><div><i style={{width:`${readyPercent}%`}}/></div></div>{questions.slice(0,4).map((q,i)=><button type="button" key={q.label} onClick={() => toggleComplete(q.label)} className={`svu-demo-check ${completedItems.includes(q.label)?'done':''}`}><span className="svu-check-box">{completedItems.includes(q.label)&&<Check size={13}/>}</span><span><b>{q.label}</b><small>{q.detail}</small></span><ArrowUpRight size={14}/></button>)}</div>}
            {workspaceTab==='Documents'&&<div className="svu-demo-documents"><div><span className="svu-doc-icon"><FileCheck2 size={17}/></span><span><b>Title / sale deed</b><small>Example document entry</small></span><em>REQUESTED</em></div><div><span className="svu-doc-icon"><FileCheck2 size={17}/></span><span><b>Survey details</b><small>Example document entry</small></span><em className="svu-doc-received">RECEIVED*</em></div><div><span className="svu-doc-icon"><FileCheck2 size={17}/></span><span><b>Encumbrance record</b><small>Period to be defined</small></span><em>TO REVIEW</em></div><p>*Illustrative status only. This is not connected to a live matter.</p></div>}
            {workspaceTab==='Timeline'&&<div className="svu-demo-timeline">{[['Submitted','Intake received'],['Scope confirmation','Awaiting confirmation'],['Review','Not started'],['Report','Not issued']].map((x,i)=><div key={x[0]} className={i===0?'current':''}><span>{i===0?<Check size={13}/>:i+1}</span><div><b>{x[0]}</b><small>{x[1]}</small></div><em>{i===0?'RECORDED':'PENDING'}</em></div>)}</div>}
            <div className="svu-demo-secure-note"><LockKeyhole size={14}/> Illustrative workspace. Real statuses appear only when recorded by the application.</div>
          </div>
        </div>
      </div>
    </section>

    <section className="svu-section svu-process-section">
      <div className="container">
        <div className="svu-section-heading"><div><div className="svu-kicker">A documented process</div><h2 className="serif">Know what happens<br/><em>after you press submit.</em></h2></div><p>The status of a request should be explicit. A step is not complete until it has actually been recorded in the workflow.</p></div>
        <div className="svu-process-layout"><div className="svu-process-steps">{steps.map((step,i)=>{const Icon=step.icon; return <button type="button" key={step.title} className={`svu-process-step ${activeStep===i?'active':''}`} onClick={() => setActiveStep(i)}><span className="svu-process-number">0{i+1}</span><span className="svu-process-icon"><Icon size={20}/></span><span className="svu-process-name">{step.title}</span><ArrowUpRight size={15}/></button>;})}</div><div className="svu-process-detail"><div className="svu-process-detail-top"><span>PROCESS STAGE / 0{activeStep+1}</span><span>SVU APPROACH</span></div><div className="svu-process-graphic"><div className="svu-process-ring ring-a"/><div className="svu-process-ring ring-b"/><div className="svu-process-center"><span>0{activeStep+1}</span><Workflow size={29}/></div></div><h3 className="serif">{steps[activeStep].title}</h3><p>{steps[activeStep].body}</p><div className="svu-process-detail-nav"><span>{activeStep+1} / {steps.length}</span><div><button aria-label="Previous step" onClick={() => setActiveStep(current => (current+steps.length-1)%steps.length)}><ArrowRight size={15} className="rotate-left"/></button><button aria-label="Next step" onClick={() => setActiveStep(current => (current+1)%steps.length)}><ArrowRight size={15}/></button></div></div></div></div>
      </div>
    </section>

    <section className="svu-knowledge-band"><div className="container svu-knowledge-grid"><div className="svu-knowledge-art"><div className="svu-knowledge-art-inner"><BookOpen size={40} strokeWidth={1.1}/><span>FIELD NOTES / PROPERTY</span><strong className="serif">Make your next question a better one.</strong><i>GUIDES · CHECKLISTS · EXPLAINERS</i></div><div className="svu-knowledge-art-index">SVU / KNOWLEDGE CENTRE</div></div><div className="svu-knowledge-copy"><div className="svu-kicker">Free knowledge centre</div><h2 className="serif">Useful information.<br/><em>Without the guesswork.</em></h2><p>Start with general information about sale deeds, title chains, encumbrance records, agricultural land questions, boundaries and dispute-resolution options.</p><div className="svu-guide-list"><Link href="/articles"><span>01</span><b>Practical property guides</b><ArrowUpRight size={15}/></Link><Link href="/knowledge"><span>02</span><b>Free purchase checklists</b><ArrowUpRight size={15}/></Link><Link href="/faq"><span>03</span><b>Answers to common questions</b><ArrowUpRight size={15}/></Link></div><Link className="svu-plain-link" href="/knowledge">Browse the knowledge centre <ArrowRight size={16}/></Link></div></div></section>

    <section className="svu-section svu-faq-section"><div className="container svu-faq-grid"><div><div className="svu-kicker">A few important answers</div><h2 className="serif">Clear expectations<br/><em>are part of good service.</em></h2><p>Legal matters deserve careful language. These boundaries are part of the process, not fine print to discover at the end.</p><Link href="/disclaimer" className="svu-plain-link">Read the legal disclaimer <ArrowUpRight size={15}/></Link></div><div className="svu-faq-list">{faqs.map(([q,a])=><details key={q}><summary>{q}<span><ChevronDown size={17}/></span></summary><p>{a}</p></details>)}</div></div></section>

    <section className="svu-final-cta"><div className="container svu-final-cta-inner"><div className="svu-final-stamp"><ShieldCheck size={25}/><span>CLARITY BEFORE<br/>COMMITMENT</span></div><div><div className="svu-kicker">Your next step starts here</div><h2 className="serif">Have a property question?<br/><em>Let's organize it properly.</em></h2><p>Describe the matter and learn what information may be needed before any scoped service is confirmed.</p></div><div className="svu-final-actions"><Link className="btn" href="/property-check">Request a property check <ArrowUpRight size={16}/></Link><Link href="/book" className="svu-final-link">Book a consultation <ArrowRight size={16}/></Link></div></div></section>
  </main>;
}
