#!/usr/bin/env node
/**
 * The executable. Everything it does lives in `cli-main.ts`.
 *
 * Split so the CLI can be run **as a function** — `main(argv)` returns the exit
 * code, and with Effect's `Console` swapped a test reads what it said without
 * starting a process. Running on import is what made that impossible.
 */
import { Effect } from 'effect';

import { main } from './cli-main.js';

process.exit(await Effect.runPromise(main(process.argv.slice(2))));
