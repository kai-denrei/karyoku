// main.js — boots the one tab. The build token in the nav is read from the
// <meta name="cb"> that bust.sh maintains, so the page says which build it is.
import { initPlateTab } from './plate-tab.js?v=42b5b52b';

const meta = document.querySelector('meta[name="cb"]');
const tok = document.getElementById('build-token');
if (meta && tok) tok.textContent = meta.content;

initPlateTab(document.getElementById('tab-plate'));
