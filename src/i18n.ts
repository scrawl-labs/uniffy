// UI strings. Korean for Korean browsers, English for everyone else.
export const lang: 'ko' | 'en' = /^ko\b/i.test(navigator.language ?? '') ? 'ko' : 'en';

const ko = {
  tagline: 'lb · °F · inch → kg · °C · cm',
  hint: '원판이나 라벨의 숫자를 네모 안에 크게 맞추고 찍으세요',
  album: '앨범',
  albumAria: '앨범에서 사진 고르기',
  shoot: '찍기',
  again: '다시 찍기',
  manualPlaceholder: '직접 입력 (예: 225 → kg)',
  noCameraApi: '이 브라우저에서는 카메라를 못 써요.\n왼쪽 아래 "앨범"으로 사진을 골라주세요.',
  cameraDenied: '카메라 권한이 꺼져 있어요.\n브라우저 설정에서 카메라를 허용하거나, 왼쪽 아래 "앨범"으로 사진을 골라주세요.',
  cameraFailed: '카메라를 켤 수 없어요.\n왼쪽 아래 "앨범"으로 사진을 골라주세요.',
  reading: '읽는 중…',
  firstLoad: '처음 한 번만 준비 중… (30MB)',
  readingStep: (n: number, total: number) => `읽는 중… ${n}/${total}`,
  readFailed: '읽기 실패. 새로고침 후 다시 해주세요',
  removeAria: '이 결과 빼기',
  allRemoved: '결과를 다 뺐어요. "다시 찍기"를 눌러주세요.',
  noneFound: '숫자를 못 찾았어요. 숫자가 네모 안에 크고 똑바로 들어오게 다시 찍어보세요. 아래 칸에 직접 입력해도 돼요.',
  platesTotal: (n: number) => `원판 ${n}장 합계`,
  barbell: '바벨 양쪽에 똑같이 꽂으면',
  barIncluded: (kg: number) => `바 ${kg}kg 포함`,
  badImage: '이미지를 열 수 없어요',
};

const en: typeof ko = {
  tagline: 'lb · °F · inch → kg · °C · cm',
  hint: 'Fit the number on the plate or label inside the box, then shoot',
  album: 'Photos',
  albumAria: 'Pick a photo',
  shoot: 'Shoot',
  again: 'Shoot again',
  manualPlaceholder: 'Type it (e.g. 225 → kg)',
  noCameraApi: "This browser can't use the camera.\nTap \"Photos\" at the bottom left to pick a photo.",
  cameraDenied: 'Camera access is turned off.\nAllow the camera in your browser settings, or tap "Photos" at the bottom left.',
  cameraFailed: "Couldn't start the camera.\nTap \"Photos\" at the bottom left to pick a photo.",
  reading: 'Reading…',
  firstLoad: 'Getting ready, first time only… (30MB)',
  readingStep: (n, total) => `Reading… ${n}/${total}`,
  readFailed: "Couldn't read it. Reload the page and try again",
  removeAria: 'Remove this result',
  allRemoved: 'You removed every result. Tap "Shoot again".',
  noneFound: "No numbers found. Shoot again with the number big and straight inside the box, or type it in below.",
  platesTotal: (n) => `${n} plates total`,
  barbell: 'Same plates on both sides of a bar',
  barIncluded: (kg) => `includes the ${kg} kg bar`,
  badImage: "Couldn't open that image",
};

export const t = lang === 'ko' ? ko : en;

/** Fill the static markup: data-i18n (text), data-i18n-placeholder, data-i18n-aria. */
export function applyStaticText(root: ParentNode = document) {
  document.documentElement.lang = lang;
  const get = (k: string) => {
    const v = t[k as keyof typeof t];
    return typeof v === 'string' ? v : '';
  };
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => (el.textContent = get(el.dataset.i18n!)));
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((el) => (el.placeholder = get(el.dataset.i18nPlaceholder!)));
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', get(el.dataset.i18nAria!)));
}
