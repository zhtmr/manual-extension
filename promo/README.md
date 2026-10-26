# 소개 영상 소스

`docs/video/page-manual-intro.mp4`(48초, 1920×1080)를 만든 소스입니다. 장면은 코드(HTML·CSS·캔버스)로 그리고 헤드리스 Chrome으로 렌더했습니다. 브라우저 화면은 실제 확장을 로드해 찍은 스크린샷(`assets/real/`)입니다.

| 파일 | 내용 |
| --- | --- |
| `concept.md` | 콘셉트, 구간별 아트 디렉션, 버린 후보 |
| `script.json` / `timeline.json` | 장면 경계·효과음·음악 시각 |
| `reel/scenes.js` | 장면 코드 |
| `tools/record.cjs` | 실제 확장 스크린샷 촬영(Playwright, 데모 서버 자동 실행) |
| `tools/measure.cjs` | 데모 페이지 요소 좌표 측정 |
| `audio/sfx/` | 효과음(ElevenLabs 생성) |

저장소에 넣지 않은 것: 음악 원본(`audio/music/`), 믹스(`audio/*.wav`), 폰트(`reel/fonts/`), 렌더 결과(`out/`), 검수 시트(`qa/`).

다시 만들려면 Claude Code의 `showreel` 스킬 도구가 필요합니다(`~/.claude/skills/showreel/scripts`).

```bash
S=~/.claude/skills/showreel/scripts
PW=<playwright 패키지 경로> node promo/tools/record.cjs          # 스크린샷
python3 $S/new_project.py promo --ratio 16:9 --duration 48          # 폰트 내려받기
python3 $S/timeline.py promo/script.json --music-analysis promo/audio/music/analysis.json
node $S/render.mjs --dir promo/reel --out promo/out/video.mp4 --sub 4 --format png --keep
python3 $S/mix.py promo/timeline.json
python3 $S/finish.py --video promo/out/video.mp4 --audio promo/audio/mix.wav --name page-manual-intro_48s --outdir promo/out --timeline promo/timeline.json --poster 43
```

`--format png` 렌더에서 청크 일부의 프레임이 빠진 적이 있습니다. `--keep`으로 조각을 남기고 조각마다 60프레임인지 확인한 뒤, 짧은 조각만 지우고 같은 명령을 다시 실행하면 그 조각만 다시 렌더합니다.
