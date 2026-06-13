import MiniPlayer from './lib/MiniPlayer.svelte';
import { mount } from 'svelte';

mount(MiniPlayer, { target: document.getElementById('app') });
