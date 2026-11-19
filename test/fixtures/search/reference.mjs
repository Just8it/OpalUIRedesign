export const rawNodes = [
  {
    id: 'course-math-special',
    type: 'course',
    title: 'Spezielle Kapitel der Mathematik',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/1001'
  },
  {
    id: 'folder-math-vl',
    type: 'folder',
    title: 'Vorlesung',
    parentId: 'course-math-special',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/1001/CourseNode/11'
  },
  {
    id: 'file-math-vl-02',
    type: 'file',
    title: 'Folien 02 Lineare Algebra.pdf',
    parentId: 'folder-math-vl',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/1001/FileResource/Folien_02_Lineare_Algebra.pdf'
  },
  {
    id: 'folder-math-ue',
    type: 'folder',
    title: 'Übung',
    parentId: 'course-math-special',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/1001/CourseNode/12'
  },
  {
    id: 'file-math-ue-2',
    type: 'file',
    title: 'Übung 2 (vom 18.10).pdf',
    parentId: 'folder-math-ue',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/1001/FileResource/Uebung_2.pdf'
  },
  {
    id: 'file-math-ue-21',
    type: 'file',
    title: 'Übung 21 (vom 5.1).pdf',
    parentId: 'folder-math-ue',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/1001/FileResource/Uebung_21.pdf'
  },
  {
    id: 'course-tm1',
    type: 'course',
    title: 'Technische Mechanik 1',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/2001'
  },
  {
    id: 'folder-tm1-skripte',
    type: 'folder',
    title: 'Skripte',
    parentId: 'course-tm1',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/2001/CourseNode/21'
  },
  {
    id: 'file-tm1-skript-2',
    type: 'file',
    title: 'Skript 2 - Schnittgrößen.pdf',
    parentId: 'folder-tm1-skripte',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/2001/FileResource/Skript_2.pdf'
  },
  {
    id: 'folder-tm1-pruefung',
    type: 'folder',
    title: 'Prüfung',
    parentId: 'course-tm1',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/2001/CourseNode/22'
  },
  {
    id: 'file-tm1-klausur-ws23',
    type: 'file',
    title: 'TM1_Klausur_WS23.pdf',
    parentId: 'folder-tm1-pruefung',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/2001/FileResource/TM1_Klausur_WS23.pdf'
  },
  {
    id: 'course-cad',
    type: 'course',
    title: 'CAD Grundlagen',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/3001'
  },
  {
    id: 'folder-cad-vl',
    type: 'folder',
    title: 'Vorlesung',
    parentId: 'course-cad',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/3001/CourseNode/31'
  },
  {
    id: 'folder-cad-folien',
    type: 'folder',
    title: 'Folien',
    parentId: 'folder-cad-vl',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/3001/CourseNode/32'
  },
  {
    id: 'file-cad-folien-01',
    type: 'file',
    title: 'Einführung CAD Folien.pdf',
    parentId: 'folder-cad-folien',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/3001/FileResource/CAD_Folien_01.pdf'
  },
  {
    id: 'course-mechanics-en',
    type: 'course',
    title: 'Computational Mechanics',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/4001'
  },
  {
    id: 'folder-mechanics-exams',
    type: 'folder',
    title: 'Exams',
    parentId: 'course-mechanics-en',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/4001/CourseNode/41'
  },
  {
    id: 'file-mechanics-exam-ws23',
    type: 'file',
    title: 'Exam Mechanics WS23.pdf',
    parentId: 'folder-mechanics-exams',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/4001/FileResource/Exam_Mechanics_WS23.pdf'
  },
  {
    id: 'folder-mechanics-notes',
    type: 'folder',
    title: 'Lecture Notes',
    parentId: 'course-mechanics-en',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/4001/CourseNode/42'
  },
  {
    id: 'file-mechanics-notes-02',
    type: 'file',
    title: 'Lecture_Notes_02.pdf',
    parentId: 'folder-mechanics-notes',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/4001/FileResource/Lecture_Notes_02.pdf'
  }
]

export const benchmarkQueries = [
  {
    query: 'Mathe Übung 21',
    expectedTop: 'file-math-ue-21',
    reason: 'course token, folder token, and exact title number should combine across the graph'
  },
  {
    query: 'tm1 skript 2',
    expectedTop: 'file-tm1-skript-2',
    reason: 'generated course alias tm1 plus title/folder token and exact number'
  },
  {
    query: 'vl cad folien',
    expectedTop: 'file-cad-folien-01',
    reason: 'generic alias vl should match Vorlesung while cad and folien match course/path/title'
  },
  {
    query: '/f klausur pdf',
    expectedTop: 'file-tm1-klausur-ws23',
    reason: 'file filter plus German exam synonym and extension'
  },
  {
    query: 'uebung 2',
    expectedTop: 'file-math-ue-2',
    notTop: 'file-math-ue-21',
    reason: 'exact number 2 must not be treated as number 21'
  },
  {
    query: 'exam mechanics ws23',
    expectedTop: 'file-mechanics-exam-ws23',
    reason: 'English course/path/title tokens should rank exact exam over generic lecture notes'
  }
]

export const scrapedLikeRawNodes = [
  {
    id: 'real-course-analysis-1',
    type: 'course',
    title: 'Analysis 1 - Vorlesung und Uebung',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/510001?0'
  },
  {
    id: 'real-folder-analysis-material',
    type: 'folder',
    title: 'Uebungsmaterial / Aufgaben',
    parentId: 'real-course-analysis-1',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/510001/CourseNode/901122?1'
  },
  {
    id: 'real-folder-analysis-solutions',
    type: 'folder',
    title: 'Loesungen',
    parentId: 'real-folder-analysis-material',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/510001/CourseNode/901123?2'
  },
  {
    id: 'real-file-analysis-blatt-07-loesung',
    type: 'file',
    title: 'Ana1_Uebungsblatt_07_Loesung.pdf',
    parentId: 'real-folder-analysis-solutions',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/510001/FileResource/Ana1_Uebungsblatt_07_Loesung.pdf?3'
  },
  {
    id: 'real-file-analysis-blatt-17-loesung',
    type: 'file',
    title: 'Ana1_Uebungsblatt_17_Loesung.pdf',
    parentId: 'real-folder-analysis-solutions',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/510001/FileResource/Ana1_Uebungsblatt_17_Loesung.pdf?4'
  },
  {
    id: 'real-course-programming',
    type: 'course',
    title: 'Grundlagen der Informatik / Programmierung',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/520001'
  },
  {
    id: 'real-folder-programming-lecture',
    type: 'folder',
    title: 'Vorlesungsmaterial',
    parentId: 'real-course-programming',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/520001/CourseNode/33101'
  },
  {
    id: 'real-folder-programming-week-03',
    type: 'folder',
    title: 'Woche 03 - Arrays und Zeiger',
    parentId: 'real-folder-programming-lecture',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/520001/CourseNode/33103'
  },
  {
    id: 'real-file-programming-vl-03-arrays',
    type: 'file',
    title: 'VL_03_Arrays_Zeiger.pdf',
    parentId: 'real-folder-programming-week-03',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/520001/FileResource/VL_03_Arrays_Zeiger.pdf'
  },
  {
    id: 'real-course-databases',
    type: 'course',
    title: 'Datenbanken und Webtechnologien',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/530001'
  },
  {
    id: 'real-folder-databases-exam',
    type: 'folder',
    title: 'Pruefungsvorbereitung',
    parentId: 'real-course-databases',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/530001/CourseNode/44101'
  },
  {
    id: 'real-file-db-klausur-ss24-loesung',
    type: 'file',
    title: 'DB_Klausur_SS24_mit_Loesung.pdf',
    parentId: 'real-folder-databases-exam',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/530001/FileResource/DB_Klausur_SS24_mit_Loesung.pdf'
  },
  {
    id: 'real-course-td-cad',
    type: 'course',
    title: 'Technische Darstellung CAD',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/540001'
  },
  {
    id: 'real-folder-td-belege',
    type: 'folder',
    title: 'Belege und Abgaben',
    parentId: 'real-course-td-cad',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/540001/CourseNode/55101'
  },
  {
    id: 'real-file-td-beleg-04',
    type: 'file',
    title: 'TD_CAD_Beleg_04_Baugruppe.zip',
    parentId: 'real-folder-td-belege',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/540001/FileResource/TD_CAD_Beleg_04_Baugruppe.zip'
  },
  {
    id: 'real-course-physics-lab',
    type: 'course',
    title: 'Physikalisches Praktikum',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/550001'
  },
  {
    id: 'real-folder-physics-protocols',
    type: 'folder',
    title: 'Protokolle',
    parentId: 'real-course-physics-lab',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/550001/CourseNode/66101'
  },
  {
    id: 'real-file-physics-protocol-02-template',
    type: 'file',
    title: 'Versuch_02_Protokollvorlage.docx',
    parentId: 'real-folder-physics-protocols',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/550001/FileResource/Versuch_02_Protokollvorlage.docx'
  },
  {
    id: 'real-file-physics-protocol-20-template',
    type: 'file',
    title: 'Versuch_20_Protokollvorlage.docx',
    parentId: 'real-folder-physics-protocols',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/550001/FileResource/Versuch_20_Protokollvorlage.docx'
  },
  {
    id: 'real-course-tm1-deep',
    type: 'course',
    title: 'Technische Mechanik 1',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/560001'
  },
  {
    id: 'real-folder-tm1-exercises',
    type: 'folder',
    title: 'Uebungen',
    parentId: 'real-course-tm1-deep',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/560001/CourseNode/230'
  },
  {
    id: 'real-folder-tm1-week-03',
    type: 'folder',
    title: 'Woche 03',
    parentId: 'real-folder-tm1-exercises',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/560001/CourseNode/231'
  },
  {
    id: 'real-folder-tm1-solutions',
    type: 'folder',
    title: 'Loesungen',
    parentId: 'real-folder-tm1-week-03',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/560001/CourseNode/232'
  },
  {
    id: 'real-file-tm1-week-03-solution',
    type: 'file',
    title: 'TM1_Uebung_03_Loesung.pdf',
    parentId: 'real-folder-tm1-solutions',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/560001/FileResource/TM1_Uebung_03_Loesung.pdf'
  },
  {
    id: 'real-course-mathe-screen',
    type: 'course',
    title: 'Mathematik fuer Maschinenwesen',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/570001'
  },
  {
    id: 'real-folder-mathe-screen-1',
    type: 'folder',
    title: '1. Uebungsblatt (20. bis 24. Oktober 2025)',
    parentId: 'real-course-mathe-screen',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/570001/CourseNode/701'
  },
  {
    id: 'real-folder-mathe-screen-16',
    type: 'folder',
    title: '16. Uebungsblatt (20. bis 24. April 2026)',
    parentId: 'real-course-mathe-screen',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/570001/CourseNode/716'
  },
  {
    id: 'real-folder-mathe-screen-20',
    type: 'folder',
    title: '20. Uebungsblatt (18. bis 22. Mai 2026)',
    parentId: 'real-course-mathe-screen',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/570001/CourseNode/720'
  },
  {
    id: 'real-file-mathe-screen-20-task',
    type: 'file',
    title: 'ue20_ma3_mw_ss26-Aufgabenstellung.pdf',
    parentId: 'real-folder-mathe-screen-20',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/570001/FileResource/ue20_ma3_mw_ss26-Aufgabenstellung.pdf'
  },
  {
    id: 'real-file-mathe-screen-20-solution',
    type: 'file',
    title: 'ue20_ma3_mw_ss26-Lsg.pdf',
    parentId: 'real-folder-mathe-screen-20',
    url: 'https://bildungsportal.sachsen.de/opal/auth/RepositoryEntry/570001/FileResource/ue20_ma3_mw_ss26-Lsg.pdf'
  }
]

export const scrapedLikeBenchmarkQueries = [
  {
    query: 'ana1 blatt 7 loesung',
    expectedTop: 'real-file-analysis-blatt-07-loesung',
    notTop: 'real-file-analysis-blatt-17-loesung',
    reason: 'scraped filenames often carry abbreviated course names and exact sheet numbers'
  },
  {
    query: 'programmierung arrays zeiger vl 03',
    expectedTop: 'real-file-programming-vl-03-arrays',
    reason: 'tokens should distribute across course, week folder, and lecture filename'
  },
  {
    query: 'db klausur ss24 loesung',
    expectedTop: 'real-file-db-klausur-ss24-loesung',
    reason: 'short filename prefix, exam synonym, semester token, and solution token'
  },
  {
    query: '/f cad beleg 04 zip',
    expectedTop: 'real-file-td-beleg-04',
    reason: 'file filter plus extension and exact assignment number'
  },
  {
    query: 'praktikum protokoll 2 docx',
    expectedTop: 'real-file-physics-protocol-02-template',
    notTop: 'real-file-physics-protocol-20-template',
    reason: 'exact number matching should prefer Versuch 02 over Versuch 20'
  },
  {
    query: 'tm1 woche 3 loesung',
    expectedTop: 'real-file-tm1-week-03-solution',
    reason: 'deep folder tokens should combine with generated course alias and file title'
  },
  {
    query: 'mathe uebung 20',
    expectedTop: 'real-folder-mathe-screen-20',
    notTop: 'real-folder-mathe-screen-1',
    reason: 'the requested sheet number 20 should beat date numbers in earlier exercise folders'
  }
]

export const fixtureSuites = [
  {
    name: 'Synthetic OPAL tree',
    rawNodes,
    benchmarkQueries
  },
  {
    name: 'Anonymized scraped-shape OPAL tree',
    rawNodes: scrapedLikeRawNodes,
    benchmarkQueries: scrapedLikeBenchmarkQueries
  }
]
