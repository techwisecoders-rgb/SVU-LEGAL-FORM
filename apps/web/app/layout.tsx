import type {Metadata} from 'next';import './globals.css';import SiteShell from '../components/SiteShell';
export const metadata:Metadata={title:{default:'SVU Developers Private Limited | Property Legal Advisory',template:'%s | SVU Developers'},description:'Structured property due diligence assistance, document review coordination and real estate dispute support in India.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><SiteShell>{children}</SiteShell></body></html>}
