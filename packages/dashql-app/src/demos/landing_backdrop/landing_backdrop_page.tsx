import * as React from 'react';

import * as baseStyles from '../../ui/foundations/banner_page.module.css';

import { useFlavorAgentFaceBrand } from '../../agent/agent_face.js';
import { DASHQL_BRAND, DBCOM_BRAND } from '../../agent/agent_face_morph.js';
import { Button, ButtonSize, ButtonVariant } from '../../ui/foundations/button.js';
import { SegmentedControl, SegmentedControlSize } from '../../ui/foundations/segmented_control.js';
import { CLOUD_DENSITIES, LandingBackdrop, type BackdropStats } from './landing_backdrop.js';
import * as styles from './landing_backdrop_page.module.css';

const BRANDS = [
    { label: 'DashQL', brand: DASHQL_BRAND },
    { label: 'Database.com', brand: DBCOM_BRAND },
];

/// The sphere of dots that turns into the brand mark, with knobs to tune it
function LandingBackdropPage(): React.ReactElement {
    const flavorBrand = useFlavorAgentFaceBrand();
    const [brand, setBrand] = React.useState(() => Math.max(0, BRANDS.findIndex(entry => entry.brand === flavorBrand)));
    const [period, setPeriod] = React.useState(10);
    const [contrast, setContrast] = React.useState(0.4);
    const [density, setDensity] = React.useState(0);
    const [particles, setParticles] = React.useState(5000);
    const [ringFps, setRingFps] = React.useState(15);
    const [outerWobble, setOuterWobble] = React.useState(0.06);
    const [gap, setGap] = React.useState(2);
    const [fly, setFly] = React.useState(0.5);
    const [lightSeconds, setLightSeconds] = React.useState(6);
    const [glow, setGlow] = React.useState(0.2);
    const [logoDensity, setLogoDensity] = React.useState(0.5);
    const [sphereDensity, setSphereDensity] = React.useState(0.5);
    const [ringDensity, setRingDensity] = React.useState(0.6);
    const [twinkleSeconds, setTwinkleSeconds] = React.useState(6);
    const [wobble, setWobble] = React.useState(0.07);
    const [markWobble, setMarkWobble] = React.useState(0.005);
    const [scale, setScale] = React.useState(0.3);
    const [eyes, setEyes] = React.useState(true);
    const [stats, setStats] = React.useState<BackdropStats | null>(null);
    const [motion, setMotion] = React.useState(() => !(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false));
    const [controlsShown, setControlsShown] = React.useState(true);

    return (
        <div className={`${baseStyles.page} ${styles.page}`}>
            <LandingBackdrop brand={BRANDS[brand].brand} period={period} contrast={contrast} motion={motion} dots={CLOUD_DENSITIES[density]} wobble={wobble} markWobble={markWobble} scale={scale} eyes={eyes} particles={particles} ringFps={ringFps} outerWobble={outerWobble} gap={gap} fly={fly} lightSeconds={lightSeconds} glow={glow} density={logoDensity} sphereDensity={sphereDensity} ringDensity={ringDensity} twinkleSeconds={twinkleSeconds} onStats={setStats} />
            {controlsShown
                ? (
                    <div className={styles.controls}>
                        <h1 className={styles.title}>Landing Backdrop</h1>
                        <label className={styles.knob}>
                            <span className={styles.control_label}>Cycle</span>
                            <input id="landing-backdrop-cycle" type="range" min={6} max={60} step={1} value={period}
                                onChange={e => setPeriod(Number(e.target.value))} />
                            <span className={styles.knob_value}>{period}s</span>
                        </label>
                        <label className={styles.knob}>
                            <span className={styles.control_label}>Size</span>
                            <input id="landing-backdrop-size" type="range" min={0.3} max={1.2} step={0.01} value={scale}
                                onChange={e => setScale(Number(e.target.value))} />
                            <span className={styles.knob_value}>{Math.round(scale * 100)}%</span>
                        </label>
                        <label className={styles.knob}>
                            <span className={styles.control_label}>Wobble</span>
                            <input id="landing-backdrop-wobble" type="range" min={0} max={0.2} step={0.005} value={wobble}
                                onChange={e => setWobble(Number(e.target.value))} />
                            <span className={styles.knob_value}>{wobble.toFixed(3)}</span>
                        </label>
                        <label className={styles.knob}>
                            <span className={styles.control_label}>Logo</span>
                            <input id="landing-backdrop-mark-wobble" type="range" min={0} max={0.12} step={0.005} value={markWobble}
                                onChange={e => setMarkWobble(Number(e.target.value))} />
                            <span className={styles.knob_value}>{markWobble.toFixed(3)}</span>
                        </label>
                        <label className={styles.knob}>
                            <span className={styles.control_label}>Light</span>
                            <input id="landing-backdrop-light" type="range" min={2} max={30} step={0.5} value={lightSeconds}
                                onChange={e => setLightSeconds(Number(e.target.value))} />
                            <span className={styles.knob_value}>{lightSeconds.toFixed(1)}s</span>
                        </label>
                        <label className={styles.knob}>
                            <span className={styles.control_label}>Glow</span>
                            <input id="landing-backdrop-glow" type="range" min={0} max={2} step={0.05} value={glow}
                                onChange={e => setGlow(Number(e.target.value))} />
                            <span className={styles.knob_value}>{glow.toFixed(2)}</span>
                        </label>
                        <label className={styles.knob}>
                            <span className={styles.control_label}>Logo dots</span>
                            <input id="landing-backdrop-density" type="range" min={0.05} max={1} step={0.01} value={logoDensity}
                                onChange={e => setLogoDensity(Number(e.target.value))} />
                            <span className={styles.knob_value}>{Math.round(logoDensity * 100)}%</span>
                        </label>
                        <label className={styles.knob}>
                            <span className={styles.control_label}>Sphere</span>
                            <input id="landing-backdrop-sphere-density" type="range" min={0.05} max={1} step={0.01} value={sphereDensity}
                                onChange={e => setSphereDensity(Number(e.target.value))} />
                            <span className={styles.knob_value}>{Math.round(sphereDensity * 100)}%</span>
                        </label>
                        <label className={styles.knob}>
                            <span className={styles.control_label}>Ring</span>
                            <input id="landing-backdrop-ring-density" type="range" min={0.05} max={1} step={0.01} value={ringDensity}
                                onChange={e => setRingDensity(Number(e.target.value))} />
                            <span className={styles.knob_value}>{Math.round(ringDensity * 100)}%</span>
                        </label>
                        <label className={styles.knob}>
                            <span className={styles.control_label}>Twinkle</span>
                            <input id="landing-backdrop-twinkle" type="range" min={0.5} max={15} step={0.1} value={twinkleSeconds}
                                onChange={e => setTwinkleSeconds(Number(e.target.value))} />
                            <span className={styles.knob_value}>{twinkleSeconds.toFixed(1)}s</span>
                        </label>
                        <label className={styles.knob}>
                            <span className={styles.control_label}>Contrast</span>
                            <input id="landing-backdrop-contrast" type="range" min={0.25} max={3} step={0.05} value={contrast}
                                onChange={e => setContrast(Number(e.target.value))} />
                            <span className={styles.knob_value}>{contrast.toFixed(2)}</span>
                        </label>
                        <div className={styles.control_row}>
                            <span className={styles.control_label}>Dots</span>
                            <SegmentedControl aria-label="Dots" size={SegmentedControlSize.Small} onChange={setDensity}>
                                {CLOUD_DENSITIES.map((count, i) => (
                                    <SegmentedControl.Button key={count} selected={density === i}>{`${count / 1000}k`}</SegmentedControl.Button>
                                ))}
                            </SegmentedControl>
                            <span className={styles.knob_value}>{stats == null ? '' : `${stats.fps} fps`}</span>
                        </div>
                        <label className={styles.knob}>
                            <span className={styles.control_label}>Particles</span>
                            <input id="landing-backdrop-particles" type="range" min={0} max={10000} step={100} value={particles}
                                onChange={e => setParticles(Number(e.target.value))} />
                            <span className={styles.knob_value}>{particles}</span>
                        </label>
                        <label className={styles.knob}>
                            <span className={styles.control_label}>Ring fps</span>
                            <input id="landing-backdrop-ring-fps" type="range" min={5} max={60} step={1} value={ringFps}
                                onChange={e => setRingFps(Number(e.target.value))} />
                            <span className={styles.knob_value}>{ringFps}</span>
                        </label>
                        <label className={styles.knob}>
                            <span className={styles.control_label}>Fly in</span>
                            <input id="landing-backdrop-fly" type="range" min={0.2} max={4} step={0.05} value={fly}
                                onChange={e => setFly(Number(e.target.value))} />
                            <span className={styles.knob_value}>{fly.toFixed(2)}s</span>
                        </label>
                        <label className={styles.knob}>
                            <span className={styles.control_label}>Gap</span>
                            <input id="landing-backdrop-gap" type="range" min={1.05} max={3} step={0.01} value={gap}
                                onChange={e => setGap(Number(e.target.value))} />
                            <span className={styles.knob_value}>{gap.toFixed(2)}</span>
                        </label>
                        <label className={styles.knob}>
                            <span className={styles.control_label}>Outer</span>
                            <input id="landing-backdrop-outer-wobble" type="range" min={0} max={0.3} step={0.005} value={outerWobble}
                                onChange={e => setOuterWobble(Number(e.target.value))} />
                            <span className={styles.knob_value}>{outerWobble.toFixed(3)}</span>
                        </label>
                        <div className={styles.renderer} data-testid="backdrop-renderer">{stats?.renderer}</div>
                        <div className={styles.control_row}>
                            <span className={styles.control_label}>Eyes</span>
                            <SegmentedControl aria-label="Eyes" size={SegmentedControlSize.Small} onChange={index => setEyes(index === 0)}>
                                <SegmentedControl.Button selected={eyes}>Shown</SegmentedControl.Button>
                                <SegmentedControl.Button selected={!eyes}>Hidden</SegmentedControl.Button>
                            </SegmentedControl>
                        </div>
                        <div className={styles.control_row}>
                            <span className={styles.control_label}>Brand</span>
                            <SegmentedControl aria-label="Brand" size={SegmentedControlSize.Small} onChange={setBrand}>
                                {BRANDS.map((entry, i) => (
                                    <SegmentedControl.Button key={entry.label} selected={brand === i}>{entry.label}</SegmentedControl.Button>
                                ))}
                            </SegmentedControl>
                        </div>
                        <div className={styles.control_row}>
                            <span className={styles.control_label}>Motion</span>
                            <SegmentedControl aria-label="Motion" size={SegmentedControlSize.Small} onChange={index => setMotion(index === 0)}>
                                <SegmentedControl.Button selected={motion}>On</SegmentedControl.Button>
                                <SegmentedControl.Button selected={!motion}>Still</SegmentedControl.Button>
                            </SegmentedControl>
                        </div>
                        <Button size={ButtonSize.Small} variant={ButtonVariant.Default} onClick={() => setControlsShown(false)}>
                            Hide controls
                        </Button>
                    </div>
                )
                : (
                    <div className={styles.controls_collapsed}>
                        <Button size={ButtonSize.Small} variant={ButtonVariant.Default} onClick={() => setControlsShown(true)}>
                            Show controls
                        </Button>
                    </div>
                )}
        </div>
    );
}

export default LandingBackdropPage;
