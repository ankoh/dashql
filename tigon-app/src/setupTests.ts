import * as crypto from 'crypto';

global['crypto'] = crypto;
global['crypto'].getRandomValues = function(buffer: any) { return crypto.randomBytes(buffer.length); }

