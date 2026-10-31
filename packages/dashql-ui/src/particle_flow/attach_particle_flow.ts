function supportsWebGL(): boolean {
    try {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('webgl2');
        if (context == null) {
            return false;
        }
        context.getExtension('WEBGL_lose_context')?.loseContext();
        return true;
    } catch {
        return false;
    }
}

/// Render the particle flow of the DashQL mark into a container and return a function that removes it again.
/// The flow is skipped without WebGL2 and while the user prefers reduced motion, three.js is only loaded when the
/// flow is rendered. The container should be positioned and sit on a dark backdrop, the lines are white.
export function attachParticleFlow(container: HTMLElement): () => void {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let generation = 0;
    let particleFlow: { dispose(): void; start(): void } | null = null;

    const syncParticleFlow = () => {
        const currentGeneration = ++generation;
        particleFlow?.dispose();
        particleFlow = null;

        if (motionQuery.matches || !supportsWebGL()) {
            return;
        }

        import('./particle_flow.js').then(({ ParticleFlow }) => {
            if (currentGeneration !== generation || motionQuery.matches) {
                return;
            }
            particleFlow = new ParticleFlow(container);
            particleFlow.start();
        }).catch(error => {
            container.replaceChildren();
            console.warn('WebGL particle background could not be initialized.', error);
        });
    };

    motionQuery.addEventListener('change', syncParticleFlow);
    syncParticleFlow();

    return () => {
        generation += 1;
        motionQuery.removeEventListener('change', syncParticleFlow);
        particleFlow?.dispose();
        particleFlow = null;
    };
}
