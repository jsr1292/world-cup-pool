import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['src/**/*.integration.test.ts'],
		testTimeout: 30_000,
		hookTimeout: 30_000
	}
});
