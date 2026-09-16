#!/usr/bin/env node
import { createCac } from 'devframe/adapters/cac';

import devframe from './src/node/devframe.ts';

await createCac(devframe).parse();
