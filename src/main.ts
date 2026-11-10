import '@fontsource/caveat/latin-400.css';
import '@fontsource/caveat/latin-600.css';
import '@fontsource/kalam/latin-400.css';
import '@fontsource/kalam/latin-700.css';
import '@fontsource/patrick-hand/latin-400.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import 'katex/dist/katex.min.css';
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

export default mount(App, { target: document.getElementById('app')! });
