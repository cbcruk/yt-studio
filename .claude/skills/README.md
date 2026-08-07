# 이 저장소에 실린 스킬

세션마다 자동으로 로드된다. 웹이든 CLI 든 같다 — 컨테이너에 `claude plugin
install` 로 깔면 그 세션에서만 살아 있어서, 남길 것은 여기에 커밋한다.

넷 다 **[mattpocock/skills](https://github.com/mattpocock/skills)** 에서 골라
왔다. 전체는 25개인데, 이 저장소가 실제로 쓸 만한 것만 가져왔다. 나머지 21개는
이슈 트래커를 쓰는 팀 흐름(`to-spec` · `to-tickets` · `wayfinder` · `triage`)이
전제이거나 여기서 이미 켜져 있는 것과 겹친다.

| 스킬 | 부르는 법 | 무엇 |
|---|---|---|
| `grill-me` | `/grill-me` | 설계 분기가 다 닫힐 때까지 캐묻는다 |
| `grilling` | 모델이 알아서 | 위가 쓰는 인터뷰 원시 도구 |
| `codebase-design` | 모델이 알아서 | 깊은 모듈 — module · interface · seam · adapter 어휘 |
| `two-axis-review` | `/two-axis-review` | 표준 축과 스펙 축을 따로 돌려 나란히 낸다 |

## 왜 `grill-me` 인가

이 저장소는 그래프 → 프롬프트 → 빌더로 방향을 세 번 틀었다. 매번 늦게 알았고,
"엣지가 할 일이 없다" 같은 것을 코드를 2,000줄 쓰고 나서 알았다. 계획을 미리
캐물어 닫는 도구가 그 자리에 있다.

## 상류와 다른 점

원본을 그대로 두는 게 원칙이고, 아래 셋만 손댔다.

1. **`code-review` → `two-axis-review` 로 이름을 바꿨다.** Claude Code 에 같은
   이름의 기본 스킬이 있어서 그대로 두면 어느 쪽이 불리는지 알 수 없다. 안쪽
   frontmatter 의 `name` 도 같이 바꿨다.
2. **이슈 트래커 자리를 PR 로 돌렸다.** 원본은 `docs/agents/issue-tracker.md` 와
   `/setup-matt-pocock-skills` 를 전제하는데 여기는 둘 다 없다. 이 저장소에서
   스펙 노릇을 하는 건 PR 본문이다.
3. **`agents/openai.yaml` 은 안 가져왔다.** 다른 런타임용이다.

갱신할 때는 상류의 이 지점과 비교하면 된다.

```
mattpocock/skills @ 84fdeffd12f2ee307994d1eb6feb48173b6e0502  (2026-08-06)
```

## 라이선스

상류가 MIT 이고 이 저장소도 MIT 라 그대로 실을 수 있다. 저작권 고지는
[LICENSE.mattpocock](LICENSE.mattpocock) 에 함께 둔다 — MIT 가 요구하는 것이라
스킬을 지우더라도 사본이 남아 있는 한 이 파일은 같이 있어야 한다.
