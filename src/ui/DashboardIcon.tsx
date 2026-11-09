export type DashboardIconName = 'scan' | 'ticket' | 'sparkle' | 'calendar' | 'pin' | 'refresh' | 'arrow' | 'saved' | 'grid' | 'receive' | 'transfer' | 'explore' | 'prepare' | 'headers' | 'activity'
const paths: Record<DashboardIconName, string> = {
 scan: 'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 12h10M12 7v10',
 ticket: 'M4 5h16v5a2 2 0 0 0 0 4v5H4v-5a2 2 0 0 0 0-4V5Zm11 0v3m0 3v2m0 3v3',
 sparkle: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
 calendar: 'M7 3v4m10-4v4M4 10h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1Zm3 9h2m4 0h2m-8 3h2',
 pin: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
 refresh: 'M20 7v5h-5M4 17v-5h5M5.5 8a7 7 0 0 1 11.6-3L20 8M4 16l2.9 3A7 7 0 0 0 18.5 16',
 arrow: 'M5 12h14m-6-6 6 6-6 6',
 saved: 'M6 3h12v18l-6-4-6 4V3Z',
 grid: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z',
 receive: 'M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6',
 transfer: 'M3 7h17m-5-5 5 5-5 5M21 17H4m5-5-5 5 5 5',
 explore: 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-5-3-2 4-4 2 2-4 4-2Z',
 prepare: 'M7 7h10v14H7V7Zm3-4h4m-5 8 3 3 3-3m-3-3v6',
 headers: 'M4 5h16v4H4V5Zm0 10h16v4H4v-4Zm4-6v6m8-6v6',
 activity: 'M3 12h4l3-8 4 16 3-8h4',
}
export function DashboardIcon({name,className=''}:{name:DashboardIconName;className?:string}){
 return <svg className={`dashboard-icon ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>
}
