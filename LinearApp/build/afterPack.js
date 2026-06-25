const { execSync } = require("node:child_process");
const path = require("node:path");

// macOS 빌드를 ad-hoc 서명한다.
// 인증서 없이 빌드한 앱은 Apple Silicon에서 "손상되었습니다"로 차단되는데,
// ad-hoc 서명(codesign --sign -)을 하면 "확인되지 않은 개발자"로 완화되어
// 우클릭 → 열기(또는 시스템 설정 → 개인정보 보호 및 보안 → 확인 없이 열기)로 실행할 수 있다.
// Windows/Linux에서는 아무것도 하지 않는다.
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  console.log(`[afterPack] ad-hoc signing: ${appPath}`);
  execSync(`codesign --force --deep --sign - "${appPath}"`, { stdio: "inherit" });
};
