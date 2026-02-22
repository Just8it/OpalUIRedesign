const fs = require('fs');

const contentJsPath = 'e:\\Programieren\\OpalRedesign\\OpalUIRedesign\\content.js';
let content = fs.readFileSync(contentJsPath, 'utf8');

const newRenderers = `
    /* ━━ Renderer — Dashboard Main (Bento Grid) ━━━━━━━━━ */

    function buildStartseiteMain(data) {
        const courses = data.courses || [];
        const favorites = data.favorites || [];
        const courseMap = new Map();
        [...favorites, ...courses].forEach(c => courseMap.set(c.href, c));
        const allLectures = Array.from(courseMap.values()).slice(0, 6);

        return \`
      <main class="w-full flex-1 p-6 md:p-8 overflow-y-auto max-w-7xl mx-auto">
        <div class="grid grid-cols-12 gap-6">
          
          <!-- Prominent Lectures -->
          <section class="col-span-12 xl:col-span-8 space-y-4">
            <div class="flex items-center justify-between mb-2">
              <h2 class="text-sm font-bold uppercase tracking-widest text-slate-500">Active Lectures</h2>
              <span class="flex items-center gap-2 text-xs text-emerald-500 font-medium">
                <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> Live Now
              </span>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              \${allLectures.length ? allLectures.map((l, i) => buildBentoCourse(l, i)).join('') : '<p class="text-slate-500 text-sm">Keine Kurse gefunden.</p>'}
            </div>
          </section>

          <!-- Calendar Widget -->
          <aside class="col-span-12 xl:col-span-4 bento-card p-6 flex flex-col">
            \${buildBentoCalendar(data.calendar)}
          </aside>

          <!-- Announcements Widget -->
          <section class="col-span-12 lg:col-span-6 space-y-4">
            \${buildBentoNews(data.news)}
          </section>

          <!-- Stats/Glance Widget -->
          <section class="col-span-12 lg:col-span-6 grid grid-cols-2 gap-4">
            \${buildBentoStats(data)}
          </section>
        </div>
        
        <footer class="mt-12 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4">
          <p class="text-[10px] text-slate-500 uppercase tracking-widest font-bold">© OPAL System Redesigned.</p>
        </footer>
      </main>\`;
    }

    function buildBentoCourse(item, index) {
        const gradients = [
            'from-indigo-600 to-violet-700 shadow-[0_0_15px_rgba(99,102,241,0.15)]',
            'from-emerald-500 to-teal-700 shadow-[0_0_15px_rgba(16,185,129,0.15)]',
            'from-rose-500 to-orange-600 shadow-[0_0_15px_rgba(244,63,94,0.15)]',
            'from-blue-500 to-cyan-600 shadow-[0_0_15px_rgba(59,130,246,0.15)]',
            'from-fuchsia-500 to-pink-600 shadow-[0_0_15px_rgba(217,70,239,0.15)]',
            'from-amber-500 to-orange-500 shadow-[0_0_15px_rgba(245,158,11,0.15)]'
        ];
        const gradTheme = gradients[index % gradients.length];
        const delay = index < 8 ? \`opal-delay-\${index + 1}\` : '';
        const displayTitle = truncate(item.title, 50);

        return \`
      <a href="\${item.href}" class="opal-anim-in \${delay} group relative overflow-hidden rounded-2xl p-5 bg-gradient-to-br \${gradTheme} h-[13.5rem] flex flex-col justify-between border border-white/10 shadow-xl transition-transform hover:-translate-y-1 no-underline">
        <div class="absolute top-0 right-0 p-4 opacity-20 group-hover:opacity-40 transition-opacity text-white">
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        </div>
        <div>
          <span class="px-2.5 py-1 bg-white/20 backdrop-blur-md rounded-full text-[9px] font-bold text-white uppercase tracking-wider">\${item.moduleCode || 'KURS'}</span>
          <h3 class="text-xl font-black text-white mt-3 leading-tight">\${escapeHtml(displayTitle)}</h3>
        </div>
        <div class="flex items-end justify-between">
          <div><p class="text-white/80 text-xs font-medium">Modul details \u2192</p></div>
          <button class="w-10 h-10 bg-white text-black rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity translate-x-4 group-hover:translate-x-0 cursor-pointer">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        </div>
      </a>\`;
    }

    function buildBentoCalendar(cal) {
        return \`
      <div class="flex items-center justify-between mb-6">
        <h3 class="font-bold text-white flex items-center gap-2">
          <svg class="text-slate-400" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          Calendar
        </h3>
        <button class="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center hover:bg-white/10 text-white transition-colors cursor-pointer" title="Add Event (Coming Soon)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>
      <div class="flex-1 flex flex-col justify-center">
        \${cal && cal.hasEvents ? \`
          <div class="bg-rose-500/10 border border-rose-500/20 rounded-xl p-4 mb-4">
            <div class="flex justify-between items-start mb-2">
              <span class="px-2 py-0.5 bg-rose-500 text-white text-[10px] font-bold rounded uppercase">Event</span>
            </div>
            <h4 class="text-white font-bold text-sm leading-tight">\${escapeHtml(cal.text)}</h4>
          </div>
        \` : \`<p class="text-sm text-slate-500 mb-6">Keine Termine in OPAL.</p>\`}
        
        <div class="grid grid-cols-7 gap-1 text-center text-[10px] text-slate-500 font-bold mb-2">
          <div>M</div><div>T</div><div>W</div><div>T</div><div>F</div><div>S</div><div>S</div>
        </div>
        <div class="grid grid-cols-7 gap-1 text-center">
          <div class="text-xs p-1.5 text-slate-600">...</div>
          <div class="text-xs p-1.5 text-white font-bold bg-[#6264f4]/20 rounded-lg ring-1 ring-[#6264f4]/40">H</div>
          <div class="text-xs p-1.5 text-slate-300">...</div>
        </div>
      </div>\`;
    }

    function buildBentoNews(news) {
        return \`
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-sm font-bold uppercase tracking-widest text-slate-500">Announcements</h2>
      </div>
      <div class="space-y-3">
        \${news && news.hasNews ? \`
          <div class="bento-card p-4 flex gap-4">
            <div class="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0 text-indigo-400">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </div>
            <div class="flex-1 min-w-0">
              <h4 class="text-sm font-bold text-white mb-1">Neue Nachricht</h4>
              <p class="text-xs text-slate-400 line-clamp-2">\${escapeHtml(news.text)}</p>
            </div>
          </div>
        \` : \`<div class="bento-card p-6 text-center text-sm text-slate-500">Alles gelesen. Keine neuen Nachrichten.</div>\`}
      </div>\`;
    }

    function buildBentoStats(data) {
        const favCount = data.favorites?.length || 0;
        const crsCount = data.courses?.length || 0;
        return \`
      <div class="bento-card p-5 flex flex-col justify-between">
        <svg class="text-rose-500 mb-4" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
        <div>
          <p class="text-2xl font-black text-white">\${crsCount}</p>
          <p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Erfasste Kurse</p>
        </div>
      </div>
      <div class="bento-card p-5 flex flex-col justify-between">
        <svg class="text-[#6264f4] mb-4" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
        <div>
          <p class="text-2xl font-black text-white">\${favCount}</p>
          <p class="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Favoriten</p>
        </div>
      </div>
      <div class="col-span-2 bento-card p-5 bg-[#6264f4]/5 border border-[#6264f4]/10">
        <div class="flex items-center gap-3">
          <div class="flex-1">
             <h4 class="text-sm font-bold text-white">OPAL Redesigned</h4>
             <p class="text-xs text-slate-400">Modulares Dashboard v2</p>
          </div>
          <span class="px-2 py-1 bg-[#6264f4] text-white text-[10px] font-bold rounded-lg uppercase">Aktiv</span>
        </div>
      </div>\`;
    }
`;

const regex = /\/\* ━━ Renderer — Startseite Main ━━━━━━━━━━━━━━━━━━━━━━ \*\/(.*?)\/\* ━━ Renderer — Kursangebote Main ━━━━━━━━━━━━━━━━━━━━ \*\//s;

if (regex.test(content)) {
    content = content.replace(regex, newRenderers + '\n\n    /* ━━ Renderer — Kursangebote Main ━━━━━━━━━━━━━━━━━━━━ */');
    fs.writeFileSync(contentJsPath, content);
    console.log("Successfully replaced Startseite blocks.");
} else {
    console.error("Could not find Startseite block in content.js");
}
