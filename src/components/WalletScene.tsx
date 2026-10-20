import { useContext, useRef, type PointerEvent } from 'react';
import { motion, MotionConfigContext, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform } from 'motion/react';
import { WALLET_IMAGE } from './CashAccount';

/** Small transforms over the existing artwork; no video, canvas or 3D runtime. */
export function WalletScene({ compact = false }: { compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const systemReduced = useReducedMotion();
  const { reducedMotion } = useContext(MotionConfigContext);
  const still = systemReduced || reducedMotion === 'always';
  const tiltX = useMotionValue(0), tiltY = useMotionValue(0);
  const x = useSpring(tiltX, { stiffness: 150, damping: 30 });
  const y = useSpring(tiltY, { stiffness: 150, damping: 30 });
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const depth = useTransform(scrollYProgress, [0, 1], [10, -10]);
  function follow(event: PointerEvent<HTMLDivElement>) {
    if (still || event.pointerType !== 'mouse') return;
    const rect = event.currentTarget.getBoundingClientRect();
    tiltX.set((.5 - (event.clientY - rect.top) / rect.height) * 6);
    tiltY.set(((event.clientX - rect.left) / rect.width - .5) * 8);
  }
  return <div ref={ref} className={`wallet-scene${compact ? ' wallet-scene-compact' : ''}`} aria-hidden="true"
    onPointerMove={follow} onPointerLeave={() => { tiltX.set(0); tiltY.set(0); }}>
    <div className="wallet-orbit wallet-orbit-back"/>
    <div className="wallet-ground"/>
    <motion.div className="wallet-depth" style={{ y: still ? 0 : depth }}>
      <motion.div className="wallet-object" style={{ rotateX: still ? 0 : x, rotateY: still ? 0 : y }}>
        <img src={WALLET_IMAGE} alt="" width="500" height="500" draggable={false} fetchPriority="high"/>
      </motion.div>
    </motion.div>
    <div className="wallet-orbit wallet-orbit-front"/>
  </div>;
}
