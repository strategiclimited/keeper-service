import { depositSync, depositMonitor } from './services';
import './services/redemption';

async function start(): Promise<void> {
  // await depositSync.init();
  // await depositMonitor.init();
}

export default {
  start,
};
