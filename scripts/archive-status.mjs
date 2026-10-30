import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const cpPath = path.join(projectRoot, '.cache', 'r2-archive-checkpoint.json');

if (existsSync(cpPath)) {
  try {
    const d = JSON.parse(readFileSync(cpPath, 'utf8'));
    const queue = Object.values(d.seriesQueue || {});
    const total = queue.length;
    const completed = queue.filter((x) => x.status === 'completed').length;
    const skipped = queue.filter((x) => x.status && x.status.startsWith('skipped')).length;
    const failed = queue.filter((x) => x.status === 'failed').length;
    const pending = queue.filter((x) => !x.status || x.status === 'pending' || x.status === 'partial').length;
    const totalMangas = Object.keys(d.mangas || {}).length;

    console.log(`  [+] Arşivdeki Seri Sayısı   : ${totalMangas}`);
    console.log(`  [+] Kuyruktaki Toplam Seri  : ${total}`);
    console.log(`  [+] Kalan İşlenecek Seri    : ${pending}`);
    console.log(`  [+] Başarıyla Tamamlanan    : ${completed}`);
    console.log(`  [+] Elenen (Ölü / BL)       : ${skipped + failed}`);
    console.log(`  [+] Son Kontrol Zamanı      : ${d.lastUpdatedAt || 'Bilinmiyor'}`);
  } catch (err) {
    console.log(`  [!] Checkpoint okuma hatası: ${err.message}`);
  }
} else {
  console.log('  [i] Henüz checkpoint bulunamadı, sıfırdan başlanacak.');
}
