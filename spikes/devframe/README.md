# devframe 스파이크

`ytstudio` 의 검사기를 [devframe](https://devfra.me) 정의 하나로 감싸서, **같은 RPC
셋이 브라우저 패널과 MCP 서버를 동시에 먹이는지** 본다. 버려도 되는 자리다 —
본체(`src/`)는 안 건드리고 `lib/` 산출물만 읽는다.

```
cd ../.. && bun run build && cd spikes/devframe
bun install
bun run build:app      # 패널 → dist/client
node bin.ts            # 패널 http://127.0.0.1:9797 (터미널의 OTP 로 인증)
node bin.ts mcp        # stdio MCP
```

RPC 는 셋이다 — `ytstudio:check` · `ytstudio:explain` · `ytstudio:source`.
전부 `agent` 가 붙어 있어서 MCP 에 `ytstudio_check` 등으로 뜬다. 개발 서버는
같은 것을 `/__mcp` (Streamable HTTP) 로도 낸다.

Claude Code 에 붙이려면:

```
claude mcp add ytstudio -- node /abs/path/spikes/devframe/bin.ts mcp
```
