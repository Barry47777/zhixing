import { createApp } from 'vue';
import router from './router';
import App from './App.vue';

/* 设计层：两套皮肤各自独立
   - studio.css / tokens.css：工作区（Studio Log 原皮肤）
   - edge/*.scoped.css：灵感与复盘（灵感 · Edge 原皮肤，只作用在 .edge-app 内） */
import './styles/tokens.css';
import './styles/studio.css';
import './styles/edge/styles.scoped.css';
import './styles/edge/tech.scoped.css';
import './styles/edge/feat.scoped.css';
import './styles/edge/desk.scoped.css';
import './styles/edge/record.scoped.css';

const el = document.getElementById('app');
if (el) {
  createApp(App).use(router).mount(el);
}
