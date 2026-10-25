const config = window.URBANEROS_CONFIG || {};
const BUCKET = "catalogo";
const BACKUP_KEY = "urbaneros-fotos-respaldo-v1";
const $ = selector => document.querySelector(selector);
const client = window.supabase?.createClient(config.url, config.publishableKey);
let products = [];
let busy = false;
let backup = null;

function log(message) {
  $("#log").textContent += `${message}\n`;
  $("#log").scrollTop = $("#log").scrollHeight;
}
function status(message) { $("#status").textContent = message; }
function saveBackup() {
  localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
  $("#download-backup").disabled = false;
  $("#restore").disabled = !backup.entries.some(entry => entry.after);
}
function downloadBackup() {
  if (!backup) return;
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `urbaneros-respaldo-fotos-${backup.createdAt.slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function storagePath(url) {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== new URL(config.url).origin) return null;
    const prefix = `/storage/v1/object/public/${BUCKET}/`;
    return parsed.pathname.startsWith(prefix) ? decodeURIComponent(parsed.pathname.slice(prefix.length)) : null;
  } catch { return null; }
}
async function optimize(blob) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(blob.type)) return null;
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const type = blob.type === "image/jpeg" ? "image/jpeg" : "image/webp";
    const result = await new Promise(resolve => canvas.toBlob(resolve, type, 0.78));
    return result?.type === type && result.size < blob.size * 0.9 ? result : null;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
async function loadProducts() {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from("products").select("id,name,photos").order("id").range(from, from + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) break;
  }
  products = all;
  const unique = new Set(all.flatMap(p => Array.isArray(p.photos) ? p.photos : []).filter(url => {
    const path = storagePath(url);
    return path && !path.startsWith("optimized/");
  }));
  $("#summary").textContent = `${all.length} productos; ${unique.size} fotos originales que podrían optimizarse.`;
  $("#run").disabled = !unique.size;
  $("#restore").disabled = !backup?.entries.some(entry => entry.after);
}
async function unlock() {
  const { data, error } = await client.rpc("is_urbaneros_admin");
  if (error || data !== true) throw new Error("La cuenta no tiene permiso de administrador.");
  $("#login-section").hidden = true;
  $("#tools-section").hidden = false;
  await loadProducts();
}
$("#login-form").addEventListener("submit", async event => {
  event.preventDefault();
  status("Verificando acceso…");
  try {
    const { error } = await client.auth.signInWithPassword({
      email: event.target.elements.email.value.trim(),
      password: event.target.elements.password.value
    });
    if (error) throw error;
    event.target.elements.password.value = "";
    await unlock();
    status("Listo para comenzar.");
  } catch (error) { status(`No se pudo iniciar sesión: ${error.message}`); }
});
$("#download-backup").addEventListener("click", downloadBackup);
$("#run").addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  $("#run").disabled = true;
  $("#restore").disabled = true;
  $("#log").textContent = "";
  if (!backup?.entries?.some(entry => entry.after)) {
    backup = { version: 1, createdAt: new Date().toISOString(), entries: [] };
  }
  for (const product of products) {
    if (!backup.entries.some(entry => entry.id === product.id)) {
      backup.entries.push({ id: product.id, name: product.name, before: product.photos, after: null });
    }
  }
  try {
    saveBackup();
    downloadBackup();
    const reused = new Map();
    let changed = 0, savedBytes = 0;
    $("#progress").max = products.length || 1;
    for (const [index, product] of products.entries()) {
      const original = Array.isArray(product.photos) ? product.photos : [];
      const next = [];
      for (const url of original) {
        const path = storagePath(url);
        if (!path || path.startsWith("optimized/")) { next.push(url); continue; }
        if (reused.has(url)) { next.push(reused.get(url)); continue; }
        status(`Producto ${index + 1} de ${products.length}: ${product.name}`);
        const { data: source, error: downloadError } = await client.storage.from(BUCKET).download(path);
        if (downloadError) throw downloadError;
        const originalType = /\.png$/i.test(path) ? "image/png" : /\.webp$/i.test(path) ? "image/webp" : /\.jpe?g$/i.test(path) ? "image/jpeg" : null;
        const imageBlob = source.type.startsWith("image/") || !originalType ? source : new Blob([source], { type: originalType });
        const optimized = await optimize(imageBlob);
        if (!optimized) { reused.set(url, url); next.push(url); continue; }
        const ext = optimized.type === "image/webp" ? "webp" : "jpg";
        const newPath = `optimized/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await client.storage.from(BUCKET).upload(newPath, optimized, {
          upsert: false, contentType: optimized.type, cacheControl: "31536000"
        });
        if (uploadError) throw uploadError;
        const newUrl = client.storage.from(BUCKET).getPublicUrl(newPath).data.publicUrl;
        reused.set(url, newUrl);
        next.push(newUrl);
        savedBytes += source.size - optimized.size;
      }
      if (next.some((url, i) => url !== original[i])) {
        const { data: fresh, error: readError } = await client.from("products").select("photos").eq("id", product.id).single();
        if (readError) throw readError;
        if (JSON.stringify(fresh.photos) !== JSON.stringify(original)) {
          log(`Omitido: ${product.name} cambió durante el proceso.`);
        } else {
          backup.entries.find(entry => entry.id === product.id).after = next;
          saveBackup();
          const { error: updateError } = await client.from("products").update({ photos: next }).eq("id", product.id);
          if (updateError) throw updateError;
          changed++;
          log(`Optimizado: ${product.name}`);
        }
      }
      $("#progress").value = index + 1;
    }
    status(`Finalizado: ${changed} productos actualizados. Reducción de archivos procesados: ${(savedBytes / 1048576).toFixed(1)} MB.`);
    await loadProducts();
  } catch (error) {
    status(`Proceso detenido: ${error.message}. Los cambios ya realizados se conservaron; puedes volver a iniciar para seguir.`);
    log(`Error: ${error.message}`);
  } finally {
    busy = false;
    $("#run").disabled = false;
    $("#restore").disabled = !backup.entries.some(entry => entry.after);
  }
});
$("#restore").addEventListener("click", async () => {
  if (busy || !backup || !confirm("¿Restaurar las direcciones anteriores? Los archivos nuevos y originales seguirán guardados.")) return;
  busy = true;
  $("#run").disabled = true;
  $("#restore").disabled = true;
  let restored = 0;
  try {
    for (const entry of backup.entries.filter(item => item.after)) {
      const { data, error } = await client.from("products").select("photos").eq("id", entry.id).single();
      if (error) throw error;
      if (JSON.stringify(data.photos) !== JSON.stringify(entry.after)) { log(`Sin restaurar (modificado después): ${entry.name}`); continue; }
      const { error: updateError } = await client.from("products").update({ photos: entry.before }).eq("id", entry.id);
      if (updateError) throw updateError;
      entry.after = null;
      saveBackup();
      restored++;
    }
    status(`Se restauraron ${restored} productos.`);
    await loadProducts();
  } catch (error) { status(`Restauración detenida: ${error.message}`); }
  finally { busy = false; $("#run").disabled = false; $("#restore").disabled = !backup.entries.some(entry => entry.after); }
});
(async () => {
  if (!client) return status("Falta la configuración de Supabase.");
  try { backup = JSON.parse(localStorage.getItem(BACKUP_KEY) || "null"); } catch { backup = null; }
  if (backup?.entries) { $("#download-backup").disabled = false; $("#restore").disabled = !backup.entries.some(entry => entry.after); }
  const { data } = await client.auth.getSession();
  if (data.session) { try { await unlock(); } catch { /* Mostrar el formulario de acceso. */ } }
})();
