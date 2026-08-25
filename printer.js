/* ══════════════════════════════════════════════════════════
   MOTOR DE IMPRESIÓN — Recibos Pocket
   Estrategia: dibujar el recibo en <canvas>, convertirlo a
   bitmap monocromo 1bpp, y enviarlo a la impresora con el
   comando raster de imagen ESC/POS ("GS v 0"). Se probó TSPL
   y ZPL con esta impresora y ambos se imprimieron como texto
   literal (la impresora no los interpretó como comandos).
   ESC/POS con impresión de imagen raster es el modo más
   universalmente soportado por impresoras térmicas Bluetooth
   SPP de bajo costo, incluso cuando el "lenguaje" configurado
   en otra app dice TSPL/ZPL — por eso lo usamos como estrategia
   principal. Al ser una IMAGEN (no texto con comandos de
   formato), lo impreso siempre coincide pixel por pixel con
   la vista previa, sin depender de que la impresora entienda
   negritas, tamaños, etc.
   ══════════════════════════════════════════════════════════ */

let serialPort = null;
let serialWriter = null;

async function connectPrinter(){
  if(!('serial' in navigator)){
    setStatus('Este navegador no soporta Web Serial. Usá Chrome Android 117+.','err');
    return;
  }
  try{
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate: 9600 });
    serialWriter = serialPort.writable.getWriter();
    setStatus('Impresora conectada. Lista para imprimir.','ok');
  }catch(e){
    setStatus('No se pudo conectar: '+e.message,'');
  }
}

async function sendBytes(bytes){
  if(!serialWriter){
    setStatus('Conectá la impresora primero (botón "Conectar impresora").','err');
    return false;
  }
  try{
    // Enviar en bloques para no saturar el buffer del adaptador Bluetooth SPP
    const CHUNK = 512;
    for(let i=0;i<bytes.length;i+=CHUNK){
      await serialWriter.write(bytes.slice(i,i+CHUNK));
      await new Promise(r=>setTimeout(r,12));
    }
    return true;
  }catch(e){
    setStatus('Error enviando datos: '+e.message,'err');
    return false;
  }
}

function strToBytes(s){
  return new TextEncoder().encode(s);
}

function concatBytes(...arrs){
  let len=0; arrs.forEach(a=>len+=a.length);
  const out=new Uint8Array(len);
  let off=0;
  arrs.forEach(a=>{ out.set(a,off); off+=a.length; });
  return out;
}

/* ── Canvas → bitmap 1bpp empaquetado, MSB primero (formato raster ESC/POS) ── */
function canvasToRasterBitmap(canvas, threshold=170){
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0,0,w,h).data;
  const bytesPerRow = Math.ceil(w/8);
  const out = new Uint8Array(bytesPerRow*h);

  for(let y=0;y<h;y++){
    for(let xByte=0; xByte<bytesPerRow; xByte++){
      let byte = 0;
      for(let bit=0; bit<8; bit++){
        const x = xByte*8+bit;
        if(x>=w) continue;
        const idx=(y*w+x)*4;
        const r=img[idx],g=img[idx+1],b=img[idx+2],a=img[idx+3];
        const lum = a===0 ? 255 : (0.299*r+0.587*g+0.114*b);
        const isBlack = lum < threshold;
        if(isBlack) byte |= (0x80 >> bit);
      }
      out[y*bytesPerRow+xByte]=byte;
    }
  }
  return { data: out, bytesPerRow, h };
}

/* ── Construye el trabajo de impresión completo en ESC/POS ──
   ESC @         → reset de la impresora (limpia cualquier estado previo)
   GS v 0 m xL xH yL yH d1...dk → imprime un bloque de imagen raster
     m = 0 (modo normal)
     xL,xH = bytes por fila (ancho en bytes), little-endian de 16 bits
     yL,yH = número de filas (alto en pixeles), little-endian de 16 bits
   ══════════════════════════════════════════════════════════════ */
function buildESCPOSJob(canvas){
  const { data, bytesPerRow, h } = canvasToRasterBitmap(canvas);

  const ESC = 0x1B, GS = 0x1D;
  const reset = new Uint8Array([ESC, 0x40]); // ESC @

  const xL = bytesPerRow & 0xFF;
  const xH = (bytesPerRow >> 8) & 0xFF;
  const yL = h & 0xFF;
  const yH = (h >> 8) & 0xFF;

  const rasterHeader = new Uint8Array([GS, 0x76, 0x30, 0x00, xL, xH, yL, yH]); // GS v 0

  const feedAndCut = strToBytes('\n\n\n\n');

  return concatBytes(reset, rasterHeader, data, feedAndCut);
}

async function printCanvasJob(canvas){
  const job = buildESCPOSJob(canvas);
  setStatus('Enviando a la impresora...','');
  const ok = await sendBytes(job);
  if(ok) setStatus('Recibo enviado. Si sale en blanco, probá ajustar el ancho en Configuración.','ok');
}

/* ── Impresión de prueba: cuadro + texto para verificar ancho/alineación ── */
async function testPrint(){
  const c = document.createElement('canvas');
  const W = parseInt(document.getElementById('cfg_width')?.value||'384');
  c.width = W; c.height = 160;
  const ctx = c.getContext('2d');
  ctx.fillStyle='#fff'; ctx.fillRect(0,0,W,160);
  ctx.fillStyle='#000';
  ctx.strokeRect(2,2,W-4,156);
  ctx.font='bold 22px monospace';
  ctx.textAlign='center';
  ctx.fillText('PRUEBA DE IMPRESORA', W/2, 40);
  ctx.font='16px monospace';
  ctx.fillText(W+' px de ancho', W/2, 70);
  ctx.fillText('Recibos Pocket · ESC/POS raster', W/2, 95);
  ctx.font='bold 14px monospace';
  ctx.fillText('Si esto sale nitido, todo bien.', W/2, 125);
  await printCanvasJob(c);
}
