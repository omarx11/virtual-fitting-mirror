/**
 * Text of the /research page, in English and Arabic. Kept apart from src/i18n so it ships only in the
 * research chunk. Lists are in the same order as the icons, tones and numbers in ResearchPage.tsx.
 * The numbers are copied from docs/RESEARCH.md, docs/TESTING.md and docs/LIMITATIONS.md; update both.
 */

import { ltr } from '../i18n/bidi';
import type { AccentText } from '../i18n/en';
import type { Locale } from '../i18n/locale';

export type ScoreStatus = 'pass' | 'partial' | 'todo';

const en = {
  back: 'Back to the mirror',
  kicker: 'Research · Testing · Limits',
  title: { pre: 'Behind the ', accent: 'mirror', post: '' } as AccentText,
  lede: 'What we built, how we put it to the test, and where it still falls short. The honest, short version.',
  stats: [
    { value: '260', label: 'automated tests' },
    { value: '33', label: 'browser tests on a real GPU' },
    { value: '30 fps', label: 'live tracking' },
    { value: '16 ms', label: 'to find a pose' },
    { value: '0', label: 'requests leave the device in 2D / 3D' },
    { value: '5 min', label: 'soak test, no memory growth' },
  ],
  sections: {
    how: { kicker: '01 · How it works', title: 'From camera to mirror in five steps' },
    research: { kicker: '02 · Research', title: 'Choices we made, and why' },
    testing: { kicker: '03 · Testing', title: 'Bugs the tests caught' },
    pictures: { kicker: '04 · In pictures', title: 'What the tests looked like' },
    scorecard: { kicker: '05 · Scorecard', title: 'What we checked on real footage' },
    limits: { kicker: '06 · Limitations', title: 'What it can’t do (yet)' },
    next: { kicker: '07 · Next', title: 'Still on the to-do list' },
  },
  pipeline: [
    { title: 'Camera', text: 'Webcam or a video file' },
    { title: 'Pose model', text: '33 body points, in a background worker' },
    { title: 'Interpreter', text: 'Facing me? Too close? Which person?' },
    { title: 'Garment', text: '2D art, men’s or women’s 3D shirt, or cloth' },
    { title: 'Mirror', text: 'Drawn over the video, flipped' },
  ],
  pipelineNote:
    'Everything above runs in the browser. Only the optional AI photo mode sends a picture to the cloud, and only after the shopper agrees.',
  chart: {
    title: 'Time to find a pose',
    subtitle: 'median milliseconds per frame · lower is better',
    label: 'Median time to find a pose',
    pick: 'our pick',
    budget: '33 ms = one video frame',
    ms: (n: number) => `${n} ms`,
  },
  backends: ['Lite model · GPU', 'Full model · GPU', 'Lite model · CPU', 'Full model · CPU'],
  choices: [
    {
      title: 'Pose model: MediaPipe “Full” on the GPU',
      why: 'Keeps up with 30 fps video. The “Heavy” model is 3× larger (30.7 MB) and would gain nothing here.',
    },
    {
      title: 'Cloth: Jolt Physics',
      why: 'Passed all four trial tests: pinned points stay within 0.1 mm, stretch stays under 5%, and the cloth never passes through the body.',
    },
    {
      title: 'AI photo: FASHN cloud API',
      why: 'The strongest open models (CatVTON, IDM-VTON) are licensed for non-commercial use only. The cloud API also avoids a Python/GPU setup on the kiosk. Garment photos show no person: with on-model shots it copied the model’s face onto the shopper.',
    },
    {
      title: 'Privacy: block the tracker’s phone-home',
      why: 'MediaPipe quietly sends usage metrics to Google. We block them twice, and a test with the blocks removed proves the test really catches it.',
    },
  ],
  fixed: 'Fixed',
  bugs: [
    {
      title: 'The 35 cm blob',
      before: 'The 3D shirt loaded as a tiny crumpled ball: its bones had no resting pose.',
      fix: 'Rebuilt the rest pose from the bind matrices. It now matches the original model to within 0.1 mm.',
    },
    {
      title: 'A shirt on someone’s back',
      before: 'In a crowd clip, the shirt appeared on a man who was facing away.',
      fix: 'The face must now be visible before a shirt is drawn.',
    },
    {
      title: 'The burpee shirt',
      before: 'Bending over stretched a full-length shirt across the floor.',
      fix: 'Bending is now detected and the shirt politely hides.',
    },
    {
      title: 'Turning looked like bending',
      before: 'Starting already turned 45° was mistaken for leaning forward.',
      fix: 'Shoulder width is corrected for the turn before any check.',
    },
  ],
  gallery: [
    {
      alt: 'Two video frames: a man before tracking starts, then the same man wearing a blue 3D shirt with both arms raised',
      caption: 'Before the tracker locks on, and after: the sleeves follow raised arms.',
    },
    {
      alt: 'Mirrored kiosk view with the tracked skeleton drawn over the 3D shirt',
      caption: 'Portrait kiosk, mirrored. The shirt’s shoulders (magenta) sit on the tracked ones.',
    },
    {
      alt: 'Eight frames of a man squatting with his back to the camera and no shirt drawn',
      caption: 'Back to the camera? The shirt stays hidden for the whole clip.',
    },
    {
      alt: 'The 3D shirt in five poses: rest, left arm raised, both arms raised, arms forward, turned 30 degrees',
      caption: 'The real 3D model in five test poses: rest, left arm up, both up, arms forward, 30° turn.',
    },
  ],
  legend: 'Legend',
  status: { pass: 'Passed', partial: 'Partly', todo: 'Not yet' } satisfies Record<ScoreStatus, string>,
  scorecard: [
    { name: 'Facing the camera, arms up and down' },
    { name: 'Starting with hips out of frame' },
    { name: 'Facing away: shirt hides' },
    { name: 'Bending over: shirt hides' },
    { name: 'Leaving and coming back' },
    { name: 'Several people: keeps the right one' },
    { name: 'Portrait kiosk, landscape, phone' },
    { name: 'Nothing sent to the internet (2D / 3D)' },
    { name: 'English and Arabic, right to left' },
    { name: 'AI across several server instances', note: 'tests + Redis in Docker' },
    { name: 'Walking closer and farther', note: 'cropped clips only' },
    { name: 'Crossed arms in front of the chest', note: 'simulated poses only' },
    { name: 'AI photo flow', note: 'with a fake provider' },
    { name: 'A real AI generation', note: 'tried by eye, not measured' },
    { name: 'A real webcam' },
    { name: 'Firefox, Safari, other GPUs' },
  ] as { name: string; note?: string }[],
  hardware:
    'Windows 10 · Ryzen 9 5900X · Radeon RX 9070 XT · Chromium 153. Real footage: openly licensed clips from Wikimedia Commons.',
  limits: [
    { title: 'Not a size tool', text: 'The shirt is scaled to look right, not measured.' },
    { title: 'Your clothes can peek out', text: 'Long sleeves, collars and loose hems stay visible.' },
    { title: 'Face the mirror', text: 'Fades from about 50° of turn, hides past 72° and from behind.' },
    { title: 'Arms overhead', text: 'Armpits stretch and sleeves bunch up.' },
    { title: 'One person at a time', text: 'In a crowd it fades out rather than jump to someone else.' },
    {
      title: 'AI photo is a still',
      text: 'About 10 s per image. It may change faces, logos or body shape, and the garment photo must show no person.',
    },
  ],
  next: [
    'Try a real webcam at the kiosk’s distance and lighting',
    'Measure speed on the actual kiosk PC',
    'Time and review real AI generations on kiosk photos',
    'Confirm the licences of the 3D shirt and the AI product photos',
    'Film crossed arms and slow full turns',
    'Test Firefox, Safari and other graphics cards',
  ],
  tryMirror: 'Try the mirror',
  footerBy: (kind: string) => `${kind} by`,
  footerNotes: 'The full notes live in `docs/RESEARCH.md`, `docs/TESTING.md` and `docs/LIMITATIONS.md`.',
  attribution:
    'Screenshots adapt “Jumping jacks and burpees” by Taco fleur (CC BY-SA 4.0) and “Squat – exercise demonstration video” by FitnessScape (CC BY 3.0), both from Wikimedia Commons; the 3D shirt is a third-party Fab model. Details in `docs/images/ATTRIBUTION.md`.',
};

export type ResearchMessages = typeof en;

const ar: ResearchMessages = {
  back: 'ارجع للمرآة',
  kicker: 'البحث · الاختبار · القيود',
  title: { pre: 'كواليس ', accent: 'المرآة', post: '' },
  lede: 'وش بنينا، وكيف اختبرناه، ووين لسّا فيه قصور. النسخة الصريحة والمختصرة.',
  stats: [
    { value: '260', label: 'اختبار آلي' },
    { value: '33', label: 'اختبار متصفح على معالج رسوميات حقيقي' },
    { value: ltr('30 fps'), label: 'تتبّع مباشر' },
    { value: ltr('16 ms'), label: 'لتحديد وضعية الجسم' },
    { value: '0', label: 'طلبات تطلع من الجهاز في 2D و3D' },
    { value: '5 دقائق', label: 'اختبار تحمّل بدون زيادة في الذاكرة' },
  ],
  sections: {
    how: { kicker: '01 · طريقة العمل', title: 'من الكاميرا للمرآة في خمس خطوات' },
    research: { kicker: '02 · البحث', title: 'قرارات اتخذناها، وليش' },
    testing: { kicker: '03 · الاختبار', title: 'أخطاء كشفتها الاختبارات' },
    pictures: { kicker: '04 · بالصور', title: 'كيف كانت الاختبارات' },
    scorecard: { kicker: '05 · النتائج', title: 'وش تحققنا منه على مقاطع حقيقية' },
    limits: { kicker: '06 · القيود', title: 'اللي ما يقدر يسوّيه (للحين)' },
    next: { kicker: '07 · الخطوة الجاية', title: 'لسّا في قائمة المهام' },
  },
  pipeline: [
    { title: 'الكاميرا', text: 'كاميرا ويب أو ملف فيديو' },
    { title: 'نموذج الوضعية', text: '33 نقطة في الجسم، في عامل خلفي' },
    { title: 'المفسّر', text: 'مقابلني؟ قريب مرة؟ أي شخص؟' },
    { title: 'القطعة', text: 'رسم 2D، أو قميص 3D رجالي أو نسائي، أو قماش' },
    { title: 'المرآة', text: 'مرسومة فوق الفيديو ومقلوبة' },
  ],
  pipelineNote:
    'كل اللي فوق يشتغل داخل المتصفح. بس وضع صورة الذكاء الاصطناعي الاختياري يرسل صورة للسحابة، وبعد موافقة المتسوّق.',
  chart: {
    title: 'الوقت لتحديد الوضعية',
    subtitle: 'الوسيط بالمللي ثانية لكل إطار · الأقل أفضل',
    label: 'الوقت الوسيط لتحديد الوضعية',
    pick: 'اختيارنا',
    budget: `${ltr('33 ms')} = إطار فيديو واحد`,
    ms: (n) => ltr(`${n} ms`),
  },
  backends: ['نموذج Lite · GPU', 'نموذج Full · GPU', 'نموذج Lite · CPU', 'نموذج Full · CPU'],
  choices: [
    {
      title: 'نموذج الوضعية: MediaPipe «Full» على معالج الرسوميات',
      why: `يلحق على فيديو 30 إطار/ث. نموذج «Heavy» أكبر بثلاث مرات (${ltr('30.7 MB')}) وما يضيف شي هنا.`,
    },
    {
      title: 'القماش: Jolt Physics',
      why: 'نجح في اختبارات التجربة الأربعة: النقاط المثبّتة ما تتحرك أكثر من 0.1 مم، والتمدد أقل من 5%، والقماش ما يخترق الجسم أبد.',
    },
    {
      title: 'صورة الذكاء الاصطناعي: واجهة FASHN السحابية',
      why: 'أقوى النماذج المفتوحة (CatVTON وIDM-VTON) مرخّصة للاستخدام غير التجاري فقط. والواجهة السحابية تغنينا عن تجهيز Python وGPU على جهاز العرض. وصور القطع بدون أشخاص: مع صور العارضين كان ينسخ وجه العارض على المتسوّق.',
    },
    {
      title: 'الخصوصية: منع التتبّع من الاتصال بالخارج',
      why: 'MediaPipe يرسل إحصائيات استخدام لـ Google بصمت. نحجبها مرتين، واختبار نشيل فيه الحجب يثبت إن الاختبار فعلًا يكشفها.',
    },
  ],
  fixed: 'انحلّت',
  bugs: [
    {
      title: 'الكتلة اللي طولها 35 سم',
      before: 'القميص ثلاثي الأبعاد كان يطلع كرة صغيرة مكرمشة: عظامه ما لها وضعية راحة.',
      fix: 'أعدنا بناء وضعية الراحة من مصفوفات الربط. الحين تطابق النموذج الأصلي بفرق أقل من 0.1 مم.',
    },
    {
      title: 'قميص على ظهر شخص',
      before: 'في مقطع فيه زحمة، طلع القميص على رجّال معطي الكاميرا ظهره.',
      fix: 'لازم الوجه يكون باين قبل ما نرسم القميص.',
    },
    {
      title: 'قميص تمرين البيربي',
      before: 'لما ينحني الشخص، كان القميص يتمدد على الأرض.',
      fix: 'الحين نكتشف الانحناء والقميص يختفي بأدب.',
    },
    {
      title: 'الالتفات كان يبان انحناء',
      before: 'البداية وأنت ملتفت 45° كانت تنفهم إنها ميلان لقدّام.',
      fix: 'نصحّح عرض الكتفين حسب الالتفات قبل أي فحص.',
    },
  ],
  gallery: [
    {
      alt: 'إطاران من فيديو: رجل قبل بدء التتبّع، ثم نفس الرجل لابس قميص أزرق ثلاثي الأبعاد ورافع يديه',
      caption: 'قبل ما يثبت التتبّع وبعده: الأكمام تتبع اليدين المرفوعة.',
    },
    {
      alt: 'عرض جهاز طولي بالمرآة مع الهيكل المتتبَّع مرسوم فوق القميص ثلاثي الأبعاد',
      caption: 'جهاز عرض طولي بوضع المرآة. أكتاف القميص (باللون الوردي) فوق الأكتاف المتتبَّعة.',
    },
    {
      alt: 'ثمانية إطارات لرجل يسوي سكوات وظهره للكاميرا بدون قميص مرسوم',
      caption: 'ظهرك للكاميرا؟ القميص يبقى مخفي طول المقطع.',
    },
    {
      alt: 'القميص ثلاثي الأبعاد في خمس وضعيات: راحة، اليد اليسرى مرفوعة، اليدين مرفوعة، اليدين لقدّام، التفات 30 درجة',
      caption:
        'النموذج ثلاثي الأبعاد الحقيقي في خمس وضعيات اختبار: راحة، يد مرفوعة، يدين، لقدّام، التفات 30°.',
    },
  ],
  legend: 'دليل الرموز',
  status: { pass: 'نجح', partial: 'جزئيًا', todo: 'للحين لا' },
  scorecard: [
    { name: 'مقابل الكاميرا، اليدين فوق وتحت' },
    { name: 'البداية والوركين برّا الصورة' },
    { name: 'معطي ظهره: القميص يختفي' },
    { name: 'منحني: القميص يختفي' },
    { name: 'يطلع ويرجع' },
    { name: 'أكثر من شخص: يتمسّك بالشخص الصحيح' },
    { name: 'جهاز طولي، وعرضي، وجوال' },
    { name: 'ما ينرسل شي للإنترنت (2D و3D)' },
    { name: 'بالعربي والإنجليزي، ومن اليمين لليسار' },
    { name: 'الذكاء الاصطناعي على أكثر من نسخة خادم', note: 'اختبارات + Redis في Docker' },
    { name: 'يقرّب ويبعّد', note: 'مقاطع مقصوصة فقط' },
    { name: 'اليدين متقاطعة قدّام الصدر', note: 'وضعيات محاكاة فقط' },
    { name: 'مسار صورة الذكاء الاصطناعي', note: 'بمزوّد وهمي' },
    { name: 'توليد حقيقي بالذكاء الاصطناعي', note: 'جرّبناه بالعين، بدون قياس' },
    { name: 'كاميرا ويب حقيقية' },
    { name: 'Firefox وSafari ومعالجات رسوميات ثانية' },
  ],
  hardware:
    'Windows 10 · Ryzen 9 5900X · Radeon RX 9070 XT · Chromium 153. المقاطع الحقيقية: مقاطع بتراخيص مفتوحة من Wikimedia Commons.',
  limits: [
    { title: 'مو أداة مقاسات', text: 'القميص يتكبّر عشان يبان مضبوط، مو مقاس.' },
    { title: 'ممكن تبان ملابسك', text: 'الأكمام الطويلة والياقات والأطراف الواسعة تبقى باينة.' },
    { title: 'قابل المرآة', text: 'يبهت من التفات 50° تقريبًا، ويختفي بعد 72° ومن الخلف.' },
    { title: 'اليدين فوق الراس', text: 'الإبط يتمدد والأكمام تتكرمش.' },
    { title: 'شخص واحد بالمرة', text: 'في الزحمة يبهت بدل ما ينط على شخص ثاني.' },
    {
      title: 'صورة الذكاء الاصطناعي ثابتة',
      text: 'حوالي 10 ث للصورة، وممكن تغيّر الوجه أو الشعارات أو شكل الجسم، وصورة القطعة لازم تكون بدون شخص.',
    },
  ],
  next: [
    'تجربة كاميرا ويب حقيقية على مسافة وإضاءة جهاز العرض',
    'قياس السرعة على كمبيوتر جهاز العرض الفعلي',
    'قياس وقت وجودة توليدات حقيقية على صور جهاز العرض',
    'تأكيد تراخيص القميص ثلاثي الأبعاد وصور منتجات الذكاء الاصطناعي',
    'تصوير اليدين المتقاطعة والالتفات الكامل البطيء',
    'اختبار Firefox وSafari وكروت شاشة ثانية',
  ],
  tryMirror: 'جرّب المرآة',
  footerBy: (kind) => `${kind} من تنفيذ`,
  footerNotes:
    'الملاحظات الكاملة في `docs/RESEARCH.md` و`docs/TESTING.md` و`docs/LIMITATIONS.md` (بالإنجليزية).',
  attribution:
    'الصور مقتبسة من «Jumping jacks and burpees» لـ Taco fleur ‏(CC BY-SA 4.0) و«Squat – exercise demonstration video» لـ FitnessScape ‏(CC BY 3.0)، وكلاهما من Wikimedia Commons؛ والقميص ثلاثي الأبعاد نموذج من Fab لطرف ثالث. التفاصيل في `docs/images/ATTRIBUTION.md`.',
};

export const RESEARCH_MESSAGES: Record<Locale, ResearchMessages> = { en, ar };
