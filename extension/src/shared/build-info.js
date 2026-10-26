// 빌드 표식. 개발 원본(extension/)에서는 데모 매뉴얼(manuals-dev/)을 함께 싣는다.
// 배포 스크립트(tools/package-extension.mjs)가 배포물에서 이 파일을 includesDevManuals: false로 바꿔 쓴다.
// 배포물도 압축 해제로 설치하면 installType이 development이므로, installType만으로는 배포물을 구별할 수 없다.
// 이 표식이 false면 manuals-dev를 아예 읽지 않는다(없는 파일을 fetch해 콘솔 오류를 남기지 않게).
export const BUILD_INFO = Object.freeze({ includesDevManuals: true });
