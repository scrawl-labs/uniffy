// UI strings. English is the default; the choice is remembered per device.

export type Locale = 'en' | 'ko';
export const LOCALES: Locale[] = ['en', 'ko'];

const en = {
  'meta.description': 'Point your camera at lb, °F or inches and see kg, °C and cm.',
  'lang.label': 'Language',
  hint: 'Fit the number on the plate or label inside the frame, then shoot',
  'album.label': 'Pick a photo',
  album: 'Photos',
  shoot: 'Shoot',
  again: 'Retake',
  'manual.placeholder': 'Type a number (e.g. 225 → kg)',
  'remove.label': 'Remove this result',
  'camera.unsupported': 'This browser can’t use the camera.\nTap “Photos” at the bottom left to pick a picture.',
  'camera.denied': 'Camera access is off.\nAllow the camera in your browser settings, or tap “Photos” at the bottom left.',
  'camera.failed': 'Couldn’t start the camera.\nTap “Photos” at the bottom left to pick a picture.',
  'status.firstLoad': 'One-time setup… (30 MB)',
  'status.reading': 'Reading…',
  'status.readingN': 'Reading… {done}/{total}',
  'status.failed': 'Couldn’t read it. Refresh and try again',
  'status.badImage': 'Couldn’t open that image',
  'empty.none': 'No numbers found. Retake with the number large and straight inside the frame, or type it below.',
  'empty.removed': 'All results removed. Tap “Retake”.',
  'sum.plates': '{n} plates total',
  'sum.barbell': 'On both sides of a barbell',
  'sum.bar': 'includes {bar} kg bar',
};

type Key = keyof typeof en;

const ko: Record<Key, string> = {
  'meta.description': '원판이나 라벨을 찍으면 lb, °F, inch를 kg, °C, cm로 바꿔줘요',
  'lang.label': '언어',
  hint: '원판이나 라벨의 숫자를 네모 안에 크게 맞추고 찍으세요',
  'album.label': '앨범에서 사진 고르기',
  album: '앨범',
  shoot: '찍기',
  again: '다시 찍기',
  'manual.placeholder': '직접 입력 (예: 225 → kg)',
  'remove.label': '이 결과 빼기',
  'camera.unsupported': '이 브라우저에서는 카메라를 못 써요.\n왼쪽 아래 "앨범"으로 사진을 골라주세요.',
  'camera.denied': '카메라 권한이 꺼져 있어요.\n브라우저 설정에서 카메라를 허용하거나, 왼쪽 아래 "앨범"으로 사진을 골라주세요.',
  'camera.failed': '카메라를 켤 수 없어요.\n왼쪽 아래 "앨범"으로 사진을 골라주세요.',
  'status.firstLoad': '처음 한 번만 준비 중… (30MB)',
  'status.reading': '읽는 중…',
  'status.readingN': '읽는 중… {done}/{total}',
  'status.failed': '읽기 실패. 새로고침 후 다시 해주세요',
  'status.badImage': '이미지를 열 수 없어요',
  'empty.none': '숫자를 못 찾았어요. 숫자가 네모 안에 크고 똑바로 들어오게 다시 찍어보세요. 아래 칸에 직접 입력해도 돼요.',
  'empty.removed': '결과를 다 뺐어요. "다시 찍기"를 눌러주세요.',
  'sum.plates': '원판 {n}장 합계',
  'sum.barbell': '바벨 양쪽에 똑같이 꽂으면',
  'sum.bar': '바 {bar}kg 포함',
};

const STRINGS: Record<Locale, Record<Key, string>> = { en, ko };
const STORAGE_KEY = 'uniffy.locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'ko') return saved;
  } catch {
    /* storage blocked */
  }
  return 'en';
}

let current: Locale = initialLocale();

export const getLocale = () => current;

export function setLocale(locale: Locale) {
  current = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* storage blocked */
  }
}

export function t(key: Key, params: Record<string, string | number> = {}): string {
  return STRINGS[current][key].replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''));
}

/** Fill static markup: data-i18n="key" sets text, data-i18n-attr="attr:key;attr:key" sets attributes. */
export function applyStatic(root: ParentNode = document) {
  document.documentElement.lang = current;
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as Key);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach((el) => {
    for (const pair of el.dataset.i18nAttr!.split(';')) {
      const [attr, key] = pair.split(':');
      el.setAttribute(attr, t(key as Key));
    }
  });
}
