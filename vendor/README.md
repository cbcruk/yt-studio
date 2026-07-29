# vendor

배포 빌드가 파이썬만으로 돌게 하려고 lit-html 을 미리 구워 둔다.
`build.py` 는 `src/ui/tpl.js` 자리에 이 파일과 별칭 몇 줄을 끼워 넣는다.

lit-html 을 올릴 때 다시 구울 것:

    npm i lit-html@latest
    npx esbuild vendor/lit-entry.js --bundle --minify --format=iife \
        --global-name=__lit --outfile=vendor/lit-html.iife.js
