import { useEffect, useRef } from "react";

// Project-specific raw-WebGL backdrop, written for this app. It follows the
// approach of ThreeUI's lightweight raw-WebGL backgrounds (single full-screen
// fragment shader, no three.js) but no ThreeUI source code is copied here.
const FRAG = `
precision mediump float;
uniform vec2 r; uniform float t;
void main(){
  vec2 p=(gl_FragCoord.xy-.5*r)/r.y;
  float d=length(p-vec2(.5*r.x/r.y-.38,-.05));
  float ring=smoothstep(.02,0.,abs(d-.32-.015*sin(t*.6+atan(p.y,p.x)*6.)));
  float glow=.06/(d+.05);
  float horizon=smoothstep(.3,.0,d);
  vec3 cloud=vec3(.941,.933,.914);
  vec3 potion=vec3(.62,.165,.353);
  vec3 pepper=vec3(.851,.376,.122);
  vec3 c=mix(cloud,potion,clamp(glow*.35,0.,.55));
  c=mix(c,pepper,ring*.75);
  c=mix(c,vec3(.15,.125,.118),horizon);
  gl_FragColor=vec4(c,1.);
}`;
const VERT = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";

export default function HorizonField({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const gl = canvas?.getContext("webgl", { antialias: true });
    if (!canvas || !gl) return;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uR = gl.getUniformLocation(prog, "r");
    const uT = gl.getUniformLocation(prog, "t");
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const draw = (ms: number) => {
      const dpr = Math.min(window.devicePixelRatio, 1.5);
      // Integer sizes: a fractional target never equals canvas.width and would reallocate every frame.
      const w = Math.floor(canvas.clientWidth * dpr), h = Math.floor(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      gl.uniform2f(uR, w, h);
      gl.uniform1f(uT, ms / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!still && !document.hidden) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    const restart = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", restart);
    // With reduced motion only one frame is drawn, so redraw when the size changes.
    window.addEventListener("resize", restart);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", restart);
      window.removeEventListener("resize", restart);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={`h-full w-full ${className}`} />;
}
