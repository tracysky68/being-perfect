window.BP_CALENDAR={
 valid(s){return s&&Number.isFinite(Date.parse(s.starts_at))&&Number.isFinite(Date.parse(s.ends_at))&&Date.parse(s.ends_at)>Date.parse(s.starts_at)},
 stamp(s){return new Date(s).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z')},
 google(course,session){if(!this.valid(session))throw Error('課程時間尚未確認');const p=new URLSearchParams({action:'TEMPLATE',text:course.title+'｜'+session.title,dates:this.stamp(session.starts_at)+'/'+this.stamp(session.ends_at),ctz:'Asia/Taipei',details:'玩美學課程。最新安排請回官方 LINE「我的課程」查看。'});return 'https://calendar.google.com/calendar/render?'+p},
 ics(course){
 const esc=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
 // Fold by UTF-8 octets; calendar readers require CRLF and 75-octet lines.
 const fold=s=>{let out='',line='',bytes=0;for(const c of s){const n=new TextEncoder().encode(c).length;if(bytes+n>74){out+=line+'\r\n';line=' ';bytes=1}line+=c;bytes+=n}return out+line};
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Being Perfect//My Courses//ZH-TW','CALSCALE:GREGORIAN'];
 for(const s of course.sessions.filter(s=>this.valid(s))){lines.push('BEGIN:VEVENT','UID:'+esc(s.id)+'@beingperfect.com.tw','DTSTAMP:'+this.stamp(new Date().toISOString()),'DTSTART:'+this.stamp(s.starts_at),'DTEND:'+this.stamp(s.ends_at),'SUMMARY:'+esc(course.title+'｜'+s.title),'DESCRIPTION:最新課程安排請回官方 LINE「我的課程」查看。','END:VEVENT')}
 lines.push('END:VCALENDAR');return lines.map(fold).join('\r\n')+'\r\n';
 }
};
