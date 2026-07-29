/**
 * 스키마 데이터 한 곳.
 *
 * 개발 서버에서는 schema.json 을 그대로 읽고, 프로덕션 빌드에서는
 * build.py 가 이 파일을 스키마 blob 한 줄로 갈아 끼운다. 그래서
 * 산출물에는 fetch 도 import 도 남지 않는다.
 */
import raw from '../../schema.json';
export const SCHEMA = raw;
