// 윈도우 안읽음 배지 이미지를 생성한다.
// - tray-base.png            : 트레이 기본 아이콘(벨)
// - tray-1..9 / tray-9plus   : 벨 + 우하단 숫자 배지 (트레이 아이콘에 구워넣음, 창 닫아도 보임)
// - overlay-1..9 / 9plus     : 단독 숫자 배지 (작업표시줄 오버레이용, 창 떠 있을 때)
// sharp(빌드 의존성)로 빌드 시 dist/badges/ 에 출력. 런타임엔 PNG만 읽으므로 sharp 불필요.
const sharp = require("sharp");
const fs = require("node:fs");
const path = require("node:path");

const ICON = path.join(__dirname, "icon.svg");
const OUT = path.join(__dirname, "..", "dist", "badges");

const KEYS = [
  ["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"],
  ["6", "6"], ["7", "7"], ["8", "8"], ["9", "9"], ["9plus", "9+"],
];

// 빨간 원 + 흰 숫자. 흰 테두리로 배경과 분리.
function badgeSvg(text, size) {
  const fs2 = text.length > 1 ? Math.round(size * 0.5) : Math.round(size * 0.62);
  const r = size / 2 - 1.5;
  return Buffer.from(
    `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">` +
    `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="#ff3b30" stroke="#ffffff" stroke-width="1.5"/>` +
    `<text x="${size / 2}" y="${size / 2}" font-family="Arial, Helvetica, sans-serif" font-size="${fs2}" ` +
    `font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${text}</text>` +
    `</svg>`,
  );
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // 트레이 기본 아이콘
  const base = await sharp(ICON).resize(32, 32).png().toBuffer();
  await sharp(base).toFile(path.join(OUT, "tray-base.png"));

  for (const [key, text] of KEYS) {
    // 단독 오버레이 배지 (32px)
    await sharp(badgeSvg(text, 32)).png().toFile(path.join(OUT, `overlay-${key}.png`));

    // 트레이용: 벨 우하단에 작은 배지(18px) 합성
    const corner = await sharp(badgeSvg(text, 18)).png().toBuffer();
    await sharp(base)
      .composite([{ input: corner, gravity: "southeast" }])
      .toFile(path.join(OUT, `tray-${key}.png`));
  }

  console.log(`[make-badges] wrote ${2 + KEYS.length * 2} files to ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
