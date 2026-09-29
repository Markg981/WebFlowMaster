import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
// High quality for a video that will be re-encoded by every platform it is uploaded to.
Config.setCrf(16);
Config.setConcurrency(4);
