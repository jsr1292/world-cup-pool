<script lang="ts">
  import Simulator from '$lib/Simulator.svelte';
  let { data } = $props();
</script>

<svelte:head><title>Simulador · {data.pool.name}</title></svelte:head>

<Simulator {data} standalone />
