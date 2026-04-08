import React, { useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { tr } from 'date-fns/locale';
import {
  Bot,
  Check,
  CheckCircle2,
  ChevronsUpDown,
  Clock3,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Unplug,
} from 'lucide-react';
import { toast } from 'sonner';
import ProxyImage from '@/components/media/ProxyImage';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAdminPageGuard } from '@/hooks/useAdminPageGuard';
import {
  createChapterAutomation,
  deleteChapterAutomation,
  listChapterAutomations,
  setChapterAutomationActive,
  testChapterAutomations,
  updateChapterAutomation,
  validateChapterAutomation,
  type ChapterAutomationUpsertInput,
} from '@/lib/chapterAutomation';
import { getMangaSummaries } from '@/lib/database';
import type {
  ChapterAutomation,
  ChapterAutomationRunStatus,
  ChapterAutomationRunSummary,
  ChapterAutomationSource,
  ChapterAutomationTestStatus,
  ChapterAutomationValidation,
  Manga,
} from '@/lib/types';
import { cn } from '@/lib/utils';

const SOURCE_OPTIONS: Array<{ value: ChapterAutomationSource; label: string }> = [
  { value: 'hayalistic', label: 'Hayalistic' },
  { value: 'webtoonhatti', label: 'WebtoonHattı' },
  { value: 'siyahmelek', label: 'SiyahMelek' },
];

const isAdultOnlyAutomationSource = (source: ChapterAutomationSource) => source === 'siyahmelek';

const DEFAULT_TIME_SLOT = '13:00';
const TURKEY_TIME_PLACEHOLDER = '13:00';
const createCheckTimeKey = () => crypto.randomUUID();
const createCheckTimeKeys = (times: string[]) => times.map(() => createCheckTimeKey());

const createEmptyForm = (): ChapterAutomationUpsertInput => ({
  mangaId: '',
  source: 'hayalistic',
  sourceUrl: '',
  checkTimes: [DEFAULT_TIME_SLOT],
  isActive: true,
});

const buildValidationInputKey = (source: ChapterAutomationSource, sourceUrl: string) => (
  `${source}:${sourceUrl.trim()}`
);

const normalizeTimeDisplay = (value?: string | null) => value?.trim() || '--:--';

const getStatusBadgeVariant = (status: ChapterAutomationRunStatus) => {
  switch (status) {
    case 'success':
      return 'default';
    case 'no_changes':
      return 'secondary';
    case 'error':
      return 'destructive';
    default:
      return 'outline';
  }
};

const getStatusLabel = (status: ChapterAutomationRunStatus) => {
  switch (status) {
    case 'idle':
      return 'Hazır';
    case 'running':
      return 'Çalışıyor';
    case 'success':
      return 'Başarılı';
    case 'no_changes':
      return 'Yeni Bölüm Yok';
    case 'error':
      return 'Hata';
    default:
      return status;
  }
};

const getTestStatusBadgeVariant = (status?: ChapterAutomationTestStatus | null) => {
  switch (status) {
    case 'success':
      return 'default';
    case 'error':
      return 'destructive';
    case 'running':
      return 'secondary';
    default:
      return 'outline';
  }
};

const getTestStatusLabel = (status?: ChapterAutomationTestStatus | null) => {
  switch (status) {
    case 'running':
      return 'Test Ediliyor';
    case 'success':
      return 'Test Başarılı';
    case 'error':
      return 'Test Başarısız';
    default:
      return 'Test Yok';
  }
};

const formatAbsoluteDate = (value?: string | null) => (
  value
    ? new Intl.DateTimeFormat('tr-TR', {
      timeZone: 'Europe/Istanbul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(value))
    : 'Henüz yok'
);

const sanitizeTimeInput = (value: string) => (
  value
    .replace(/[^\d:]/g, '')
    .slice(0, 5)
);

const formatRelativeDate = (value?: string | null) => {
  if (!value) {
    return 'Henüz çalışmadı';
  }

  return formatDistanceToNow(new Date(value), {
    addSuffix: true,
    locale: tr,
  });
};

const formatRelativeTestDate = (value?: string | null) => (
  value ? formatRelativeDate(value) : 'Henüz test yok'
);

const getSourceUrlPlaceholder = (source: ChapterAutomationSource) => {
  if (source === 'siyahmelek') {
    return 'https://siyahmelek.mom/manga/...';
  }

  return 'https://hayalistic.com/manga/... veya https://webtoonhatti.club/webtoon/...';
};

const AdminAutomation: React.FC = () => {
  const { isAllowed, isLoading: accessLoading } = useAdminPageGuard({ requiredRole: 'admin' });
  const [mangas, setMangas] = useState<Manga[]>([]);
  const [automations, setAutomations] = useState<ChapterAutomation[]>([]);
  const [recentRuns, setRecentRuns] = useState<ChapterAutomationRunSummary[]>([]);
  const [mangaQuery, setMangaQuery] = useState('');
  const [isMangaPickerOpen, setIsMangaPickerOpen] = useState(false);
  const [editingAutomationId, setEditingAutomationId] = useState<string | null>(null);
  const [form, setForm] = useState<ChapterAutomationUpsertInput>(() => createEmptyForm());
  const [checkTimeKeys, setCheckTimeKeys] = useState<string[]>(() => createCheckTimeKeys(createEmptyForm().checkTimes));
  const [validation, setValidation] = useState<ChapterAutomationValidation | null>(null);
  const [lastValidatedInputKey, setLastValidatedInputKey] = useState('');
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isValidating, setIsValidating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [busyAutomationId, setBusyAutomationId] = useState<string | null>(null);
  const [testingAutomationIds, setTestingAutomationIds] = useState<string[]>([]);
  const [isTestingAll, setIsTestingAll] = useState(false);
  const [pendingDeleteAutomation, setPendingDeleteAutomation] = useState<ChapterAutomation | null>(null);
  const requiresAdultManga = isAdultOnlyAutomationSource(form.source);

  const availableMangasForSource = useMemo(
    () => (requiresAdultManga ? mangas.filter((manga) => manga.isAdult === true) : mangas),
    [requiresAdultManga, mangas],
  );

  const filteredMangas = useMemo(() => {
    const query = mangaQuery.trim().toLocaleLowerCase('tr-TR');
    if (!query) {
      return availableMangasForSource;
    }

    return availableMangasForSource.filter((manga) => (
      [manga.title, ...(manga.alternativeTitles || [])]
        .join(' ')
        .toLocaleLowerCase('tr-TR')
        .includes(query)
    ));
  }, [availableMangasForSource, mangaQuery]);

  const selectedManga = useMemo(
    () => mangas.find((manga) => manga.id === form.mangaId) || null,
    [form.mangaId, mangas],
  );
  const hasAdultSourceMismatch = requiresAdultManga && selectedManga?.isAdult !== true;

  const testingAutomationIdSet = useMemo(
    () => new Set(testingAutomationIds),
    [testingAutomationIds],
  );

  const currentValidationInputKey = buildValidationInputKey(form.source, form.sourceUrl);
  const validationIsFresh = Boolean(
    validation
      && lastValidatedInputKey === currentValidationInputKey
      && validation.source === form.source,
  );

  const canSave = Boolean(
    form.mangaId
      && form.sourceUrl.trim()
      && form.checkTimes.some((time) => time.trim())
      && !hasAdultSourceMismatch
      && validationIsFresh,
  );

  const ensureAdultCompatibleSelection = () => {
    if (!requiresAdultManga) {
      return true;
    }

    if (!selectedManga) {
      toast.error('SiyahMelek otomasyonu için 18+ seriyi seçmelisiniz.');
      return false;
    }

    if (selectedManga.isAdult !== true) {
      toast.error('SiyahMelek sadece 18+ olarak işaretlenmiş serilere bağlanabilir.');
      return false;
    }

    return true;
  };

  const loadPageData = async () => {
    const [nextMangas, automationData] = await Promise.all([
      getMangaSummaries({ includePrivate: true }),
      listChapterAutomations(),
    ]);

    setMangas(nextMangas);
    setAutomations(automationData.automations);
    setRecentRuns(automationData.recentRuns);
  };

  useEffect(() => {
    if (accessLoading || !isAllowed) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        setIsBootstrapping(true);
        await loadPageData();
      } catch (error) {
        if (!cancelled) {
          console.error('Chapter automation page load failed:', error);
          toast.error(error instanceof Error ? error.message : 'Otomasyon verileri yüklenemedi');
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessLoading, isAllowed]);

  const resetForm = () => {
    const nextForm = createEmptyForm();
    setEditingAutomationId(null);
    setForm(nextForm);
    setCheckTimeKeys(createCheckTimeKeys(nextForm.checkTimes));
    setValidation(null);
    setLastValidatedInputKey('');
    setMangaQuery('');
    setIsMangaPickerOpen(false);
  };

  const startEditing = (automation: ChapterAutomation) => {
    const nextCheckTimes = automation.checkTimes.length > 0 ? [...automation.checkTimes] : [DEFAULT_TIME_SLOT];
    setEditingAutomationId(automation.id);
    setForm({
      mangaId: automation.mangaId,
      source: automation.source,
      sourceUrl: automation.sourceUrl,
      checkTimes: nextCheckTimes,
      isActive: automation.isActive,
    });
    setCheckTimeKeys(createCheckTimeKeys(nextCheckTimes));
    setValidation(automation.validation);
    setLastValidatedInputKey(buildValidationInputKey(automation.source, automation.sourceUrl));
    setMangaQuery('');
    setIsMangaPickerOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleValidate = async () => {
    if (!form.sourceUrl.trim()) {
      toast.error('Kaynak linkini girin');
      return;
    }

    if (!ensureAdultCompatibleSelection()) {
      return;
    }

    try {
      setIsValidating(true);
      const nextValidation = await validateChapterAutomation(form.source, form.sourceUrl);
      setValidation(nextValidation);
      setLastValidatedInputKey(currentValidationInputKey);
      toast.success('Kaynak linki doğrulandı');
    } catch (error) {
      console.error('Chapter automation validation failed:', error);
      setValidation(null);
      setLastValidatedInputKey('');
      toast.error(error instanceof Error ? error.message : 'Kaynak linki doğrulanamadı');
    } finally {
      setIsValidating(false);
    }
  };

  const handleSave = async () => {
    if (!canSave) {
      toast.error('Kaynağı doğrulayıp tüm zorunlu alanları doldurun');
      return;
    }

    if (!ensureAdultCompatibleSelection()) {
      return;
    }

    try {
      setIsSaving(true);

      if (editingAutomationId) {
        await updateChapterAutomation(editingAutomationId, form);
        toast.success('Otomasyon güncellendi');
      } else {
        await createChapterAutomation(form);
        toast.success('Otomasyon oluşturuldu');
      }

      await loadPageData();
      resetForm();
    } catch (error) {
      console.error('Chapter automation save failed:', error);
      toast.error(error instanceof Error ? error.message : 'Otomasyon kaydedilemedi');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleActive = async (automation: ChapterAutomation, nextValue: boolean) => {
    try {
      setBusyAutomationId(automation.id);
      await setChapterAutomationActive(automation.id, nextValue);
      await loadPageData();
      toast.success(nextValue ? 'Otomasyon aktif edildi' : 'Otomasyon pasife alındı');
    } catch (error) {
      console.error('Chapter automation status toggle failed:', error);
      toast.error(error instanceof Error ? error.message : 'Otomasyon durumu güncellenemedi');
    } finally {
      setBusyAutomationId(null);
    }
  };

  const markAutomationsTesting = (automationIds: string[]) => {
    setTestingAutomationIds((current) => Array.from(new Set([...current, ...automationIds])));
  };

  const clearAutomationsTesting = (automationIds: string[]) => {
    const clearedIds = new Set(automationIds);
    setTestingAutomationIds((current) => current.filter((automationId) => !clearedIds.has(automationId)));
  };

  const handleTestAutomations = async (automationIds?: string[]) => {
    const targetAutomationIds = automationIds?.length
      ? automationIds
      : automations.map((automation) => automation.id);

    if (targetAutomationIds.length === 0) {
      toast.error('Test edilecek otomasyon yok');
      return;
    }

    try {
      markAutomationsTesting(targetAutomationIds);
      setIsTestingAll(!automationIds?.length);

      const result = await testChapterAutomations(automationIds);
      const failedCount = result.testResults.filter((testResult) => testResult.status === 'error').length;

      await loadPageData();

      if (failedCount > 0) {
        toast.error(`${failedCount} otomasyon testi başarısız oldu`);
      } else {
        toast.success(`${result.testResults.length} otomasyon testi başarılı`);
      }
    } catch (error) {
      console.error('Chapter automation test failed:', error);
      toast.error(error instanceof Error ? error.message : 'Otomasyon testi çalıştırılamadı');
    } finally {
      clearAutomationsTesting(targetAutomationIds);
      setIsTestingAll(false);
    }
  };

  const handleDelete = async () => {
    if (!pendingDeleteAutomation) {
      return;
    }

    try {
      setBusyAutomationId(pendingDeleteAutomation.id);
      await deleteChapterAutomation(pendingDeleteAutomation.id);
      await loadPageData();
      if (editingAutomationId === pendingDeleteAutomation.id) {
        resetForm();
      }
      toast.success('Otomasyon silindi');
    } catch (error) {
      console.error('Chapter automation delete failed:', error);
      toast.error(error instanceof Error ? error.message : 'Otomasyon silinemedi');
    } finally {
      setBusyAutomationId(null);
      setPendingDeleteAutomation(null);
    }
  };

  const updateCheckTime = (index: number, value: string) => {
    setForm((current) => ({
      ...current,
      checkTimes: current.checkTimes.map((time, timeIndex) => (
        timeIndex === index ? value : time
      )),
    }));
  };

  const addCheckTime = () => {
    setForm((current) => ({
      ...current,
      checkTimes: [...current.checkTimes, DEFAULT_TIME_SLOT],
    }));
    setCheckTimeKeys((current) => [...current, createCheckTimeKey()]);
  };

  const removeCheckTime = (index: number) => {
    setForm((current) => ({
      ...current,
      checkTimes: current.checkTimes.filter((_, timeIndex) => timeIndex !== index),
    }));
    setCheckTimeKeys((current) => current.filter((_, timeIndex) => timeIndex !== index));
  };

  useEffect(() => {
    setCheckTimeKeys((current) => {
      if (current.length === form.checkTimes.length) {
        return current;
      }

      if (current.length < form.checkTimes.length) {
        return [
          ...current,
          ...Array.from(
            { length: form.checkTimes.length - current.length },
            () => createCheckTimeKey(),
          ),
        ];
      }

      return current.slice(0, form.checkTimes.length);
    });
  }, [form.checkTimes.length]);

  useEffect(() => {
    if (form.checkTimes.length > 0) {
      return;
    }

    const nextCheckTimes = [DEFAULT_TIME_SLOT];
    setForm((current) => ({
      ...current,
      checkTimes: nextCheckTimes,
    }));
    setCheckTimeKeys(createCheckTimeKeys(nextCheckTimes));
  }, [form.checkTimes.length]);

  if (accessLoading || !isAllowed) {
    return null;
  }

  return (
    <div className="space-y-6 lg:space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex rounded-2xl bg-primary/10 p-3 text-primary">
            <Bot className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Otomasyon</h1>
            <p className="text-sm leading-6 text-muted-foreground sm:text-base">
              Admin panelinden manga bazlı bölüm kontrol zamanları tanımla. Sistem belirlediğin saatlerde arka planda
              yeni bölümleri kontrol edip sadece eksik olanları ekler.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="h-8 gap-1 border-primary/20 bg-primary/5 text-primary">
            <ShieldCheck className="h-4 w-4" />
            Sadece Admin
          </Badge>
          <Badge variant="outline" className="h-8 border-primary/20 bg-primary/5 text-primary">
            Proxy: Cloudflare
          </Badge>
          <Badge variant="outline" className="h-8 border-primary/20 bg-primary/5 text-primary">
            Saat Dilimi: Europe/Istanbul
          </Badge>
        </div>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.12fr)_minmax(360px,0.88fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{editingAutomationId ? 'Otomasyonu Düzenle' : 'Yeni Bölüm Otomasyonu'}</CardTitle>
              <CardDescription>
                Şimdilik sadece bölüm otomasyonu destekleniyor. Kaynağı doğrulayıp günlük kontrol saatlerini belirle.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Otomasyon Tipi</Label>
                  <div className="flex h-10 items-center rounded-md border border-border bg-muted/40 px-3 text-sm">
                    Bölüm Otomasyonu
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Kaynak Site</Label>
                  <Select
                    value={form.source}
                    onValueChange={(value) => setForm((current) => ({ ...current, source: value as ChapterAutomationSource }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SOURCE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {requiresAdultManga ? (
                <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  SiyahMelek kaynağı sadece 18+ olarak işaretlenmiş yerel seriler için kullanılabilir.
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="manga-picker">Siteden Manga Seç</Label>
                    <Popover open={isMangaPickerOpen} onOpenChange={setIsMangaPickerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          id="manga-picker"
                          variant="outline"
                          role="combobox"
                          aria-expanded={isMangaPickerOpen}
                          className="h-auto min-h-10 w-full justify-between px-3 py-2 text-left font-normal"
                        >
                          <div className="min-w-0">
                            {selectedManga ? (
                              <div className="min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="truncate text-sm font-medium">{selectedManga.title}</p>
                                  {selectedManga.isAdult ? (
                                    <Badge variant="outline" className="border-rose-500/20 bg-rose-500/10 text-rose-500">
                                      18+
                                    </Badge>
                                  ) : null}
                                </div>
                                {selectedManga.alternativeTitles?.[0] ? (
                                  <p className="truncate text-xs text-muted-foreground">
                                    {selectedManga.alternativeTitles[0]}
                                  </p>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                Manga ara, alternatif isimle bul ve seç
                              </span>
                            )}
                          </div>
                          <ChevronsUpDown className="ml-3 h-4 w-4 shrink-0 opacity-60" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[min(92vw,420px)] p-0" align="start">
                        <Command shouldFilter={false}>
                          <CommandInput
                            value={mangaQuery}
                            onValueChange={setMangaQuery}
                            placeholder="Başlık veya alternatif isim yaz"
                          />
                          <CommandList>
                            <CommandEmpty>Eşleşen manga bulunamadı.</CommandEmpty>
                            <CommandGroup>
                              {filteredMangas.slice(0, 300).map((manga) => (
                                <CommandItem
                                  key={manga.id}
                                  value={`${manga.title} ${(manga.alternativeTitles || []).join(' ')}`}
                                  className="items-start gap-3 py-3"
                                  onSelect={() => {
                                    setForm((current) => ({ ...current, mangaId: manga.id }));
                                    setIsMangaPickerOpen(false);
                                    setMangaQuery('');
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      'mt-0.5 h-4 w-4 shrink-0',
                                      form.mangaId === manga.id ? 'opacity-100' : 'opacity-0',
                                    )}
                                  />
                                  <div className="min-w-0 space-y-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <p className="truncate text-sm font-medium">{manga.title}</p>
                                      {manga.isAdult ? (
                                        <Badge variant="outline" className="border-rose-500/20 bg-rose-500/10 text-rose-500">
                                          18+
                                        </Badge>
                                      ) : null}
                                    </div>
                                    {manga.alternativeTitles?.length ? (
                                      <p className="line-clamp-2 text-xs text-muted-foreground">
                                        {manga.alternativeTitles.join(' • ')}
                                      </p>
                                    ) : null}
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <p className="text-xs text-muted-foreground">
                      Arama başlık ve alternatif isimler üzerinde çalışır.
                    </p>
                  </div>

                  {selectedManga ? (
                    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
                      <ProxyImage
                        src={selectedManga.cover}
                        alt={selectedManga.title}
                        allowProxy
                        className="h-16 w-12 rounded-xl border border-border object-cover"
                      />
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-semibold">{selectedManga.title}</p>
                          {selectedManga.isAdult ? (
                            <Badge variant="outline" className="border-rose-500/20 bg-rose-500/10 text-rose-500">
                              18+
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Local bölüm sayısı: {selectedManga.chapterCount ?? selectedManga.chapters.length}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
                      Otomasyonu bağlamak istediğin local seri burada görünecek.
                    </div>
                  )}

                  {hasAdultSourceMismatch ? (
                    <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-xs text-rose-100">
                      Seçili seri 18+ değil. SiyahMelek otomasyonu kurmadan önce seriyi admin düzenleme ekranından 18+ olarak işaretlemelisin.
                    </div>
                  ) : null}
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="source-url">Kaynak Seri Linki</Label>
                    <Input
                      id="source-url"
                      value={form.sourceUrl}
                      onChange={(event) => setForm((current) => ({ ...current, sourceUrl: event.target.value }))}
                      placeholder={getSourceUrlPlaceholder(form.source)}
                    />
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <Button onClick={handleValidate} disabled={isValidating || !form.sourceUrl.trim() || hasAdultSourceMismatch} className="sm:w-auto">
                      {isValidating ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                      )}
                      Linki Doğrula
                    </Button>
                    <p className="text-xs leading-5 text-muted-foreground">
                      Doğrulama server tarafında yapılır. Başlık uyuşmasa bile manuel onayla kaydedebilirsin.
                    </p>
                  </div>

                  <div className="rounded-2xl border border-border bg-secondary/20 p-4">
                    {validation ? (
                      <div className="space-y-4">
                        <div className="flex items-start gap-3">
                          {validation.cover ? (
                            <ProxyImage
                              src={validation.cover}
                              alt={validation.sourceTitle}
                              allowProxy
                              className="h-20 w-14 rounded-xl border border-border object-cover"
                            />
                          ) : (
                            <div className="flex h-20 w-14 items-center justify-center rounded-xl border border-border bg-muted text-xs text-muted-foreground">
                              Kapak yok
                            </div>
                          )}
                          <div className="min-w-0 flex-1 space-y-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-semibold">{validation.sourceTitle}</p>
                              <Badge variant={validationIsFresh ? 'default' : 'secondary'}>
                                {validationIsFresh ? 'Doğrulandı' : 'Yeniden Doğrula'}
                              </Badge>
                            </div>
                            <p className="break-all text-xs text-muted-foreground">{validation.normalizedUrl}</p>
                            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                              <span>Toplam bölüm: {validation.chapterCount}</span>
                              <span>Son bölüm: {validation.latestChapterNumber ?? 'Bilinmiyor'}</span>
                              <span>Kontrol: {formatAbsoluteDate(validation.checkedAt)}</span>
                            </div>
                          </div>
                        </div>

                        {!validationIsFresh ? (
                          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                            Kaynak site veya link değişti. Kaydetmeden önce yeniden doğrulama yapmalısın.
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="space-y-2 text-sm text-muted-foreground">
                        <p>Doğrulama bekleniyor.</p>
                        <p className="text-xs">
                          Sistem başlık, normalize URL, kapak ve kaynak bölüm sayısını burada gösterecek.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <Label>Günlük Kontrol Saatleri</Label>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Girdiğin her saat Istanbul saatine göre çalışır. Format `HH:mm` olmalı; örnek `13:00`, `15:00`, `17:00`.
                    </p>
                  </div>
                  <Button variant="outline" onClick={addCheckTime} className="shrink-0">
                    <Plus className="mr-2 h-4 w-4" />
                    Saat Ekle
                  </Button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  {form.checkTimes.map((time, index) => (
                    <div key={checkTimeKeys[index] || `check-time-${index}`} className="flex items-center gap-2">
                      <Input
                        type="text"
                        inputMode="numeric"
                        lang="tr-TR"
                        placeholder={TURKEY_TIME_PLACEHOLDER}
                        value={time}
                        onChange={(event) => updateCheckTime(index, sanitizeTimeInput(event.target.value))}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => removeCheckTime(index)}
                        disabled={form.checkTimes.length <= 1}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
                  Günlük kontrol: <span className="font-semibold text-foreground">{form.checkTimes.length}</span> kez
                  {form.checkTimes.length > 0 ? ` (${form.checkTimes.map(normalizeTimeDisplay).join(' • ')})` : ''}
                </div>
              </div>

              <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card px-4 py-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <Label className="text-sm">Aktif Durum</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pasife alınan otomasyon kaydı kalır ama cron tarafından işlenmez.
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant={form.isActive ? 'default' : 'secondary'}>
                    {form.isActive ? 'Aktif' : 'Pasif'}
                  </Badge>
                  <Switch
                    checked={form.isActive}
                    onCheckedChange={(checked) => setForm((current) => ({ ...current, isActive: checked }))}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                {editingAutomationId ? (
                  <Button variant="outline" onClick={resetForm}>
                    Düzenlemeyi Temizle
                  </Button>
                ) : null}
                <Button onClick={handleSave} disabled={isSaving || !canSave}>
                  {isSaving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  {editingAutomationId ? 'Otomasyonu Güncelle' : 'Otomasyonu Kaydet'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Son Çalışma Geçmişi</CardTitle>
              <CardDescription>
                En son tetiklenen otomasyon koşularının kısa log özeti.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {recentRuns.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                  Henüz otomasyon koşusu oluşmadı.
                </div>
              ) : (
                <ScrollArea className="max-h-[360px] pr-4">
                  <div className="space-y-3">
                    {recentRuns.map((run) => (
                      <div key={run.id} className="rounded-2xl border border-border bg-card px-4 py-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant={getStatusBadgeVariant(run.status)}>
                              {getStatusLabel(run.status)}
                            </Badge>
                            <span className="text-sm font-medium">{formatRelativeDate(run.startedAt)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{formatAbsoluteDate(run.startedAt)}</p>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                          <span>Eklenen: {run.chaptersAdded}</span>
                          <span>Yeni bulunan: {run.newChapterCount}</span>
                          <span>Kaynak toplamı: {run.sourceChapterCount}</span>
                        </div>
                        {run.errorMessage ? (
                          <p className="mt-3 text-xs text-destructive">{run.errorMessage}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="self-start overflow-hidden">
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <CardTitle>Tanımlı Otomasyonlar</CardTitle>
                <CardDescription>
                  Her manga için doğrulanmış link ve saat listesini ayrı ayrı yönetebilirsin.
                </CardDescription>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => void handleTestAutomations()}
                  disabled={isBootstrapping || isTestingAll || testingAutomationIds.length > 0 || automations.length === 0}
                >
                  {isTestingAll ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  Hepsini Test Et
                </Button>
                <Button variant="outline" size="icon" onClick={() => void loadPageData()} disabled={isBootstrapping}>
                  <RefreshCw className={`h-4 w-4 ${isBootstrapping ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isBootstrapping ? (
              <div className="flex min-h-[260px] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : automations.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                Henüz kayıtlı otomasyon yok.
              </div>
            ) : (
              <div className="max-h-[min(68vh,920px)] overflow-y-auto overscroll-contain pr-3 [scrollbar-gutter:stable] sm:pr-4">
                <div className="space-y-4">
                  {automations.map((automation) => {
                    const isTesting = testingAutomationIdSet.has(automation.id);
                    const isMutationBusy = busyAutomationId === automation.id;
                    const isBusy = isMutationBusy || isTesting;
                    const isEditing = editingAutomationId === automation.id;

                    return (
                      <div
                        key={automation.id}
                        className={`rounded-2xl border px-4 py-4 transition-colors ${
                          isEditing ? 'border-primary bg-primary/5' : 'border-border bg-card'
                        }`}
                      >
                        <div className="flex flex-col gap-4">
                          <div className="flex items-start gap-3">
                            {automation.mangaCover ? (
                              <ProxyImage
                                src={automation.mangaCover}
                                alt={automation.mangaTitle}
                                allowProxy
                                className="h-16 w-12 rounded-xl border border-border object-cover"
                              />
                            ) : (
                              <div className="flex h-16 w-12 items-center justify-center rounded-xl border border-border bg-muted text-[10px] text-muted-foreground">
                                Kapak
                              </div>
                            )}
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate text-sm font-semibold">{automation.mangaTitle}</p>
                                <Badge variant={automation.isActive ? 'default' : 'secondary'}>
                                  {automation.isActive ? 'Aktif' : 'Pasif'}
                                </Badge>
                                <Badge variant={getStatusBadgeVariant(automation.lastRunStatus)}>
                                  {getStatusLabel(automation.lastRunStatus)}
                                </Badge>
                                <Badge variant={getTestStatusBadgeVariant(automation.lastTestStatus)}>
                                  {getTestStatusLabel(automation.lastTestStatus)}
                                </Badge>
                              </div>

                              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                <span>{SOURCE_OPTIONS.find((option) => option.value === automation.source)?.label}</span>
                                <span>Kontrol: {automation.checkTimes.map(normalizeTimeDisplay).join(' • ')}</span>
                              </div>

                              <p className="line-clamp-2 break-all text-xs text-muted-foreground">
                                {automation.sourceUrl}
                              </p>
                            </div>

                          </div>

                          <div className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
                            <div className="rounded-xl border border-border bg-muted/20 px-3 py-3">
                              <div className="flex items-center gap-2 text-foreground">
                                <Clock3 className="h-4 w-4" />
                                <span className="font-medium">Sıradaki Çalışma</span>
                              </div>
                              <p className="mt-2">{formatAbsoluteDate(automation.nextRunAt)}</p>
                              <p className="mt-1">{formatRelativeDate(automation.nextRunAt)}</p>
                            </div>

                            <div className="rounded-xl border border-border bg-muted/20 px-3 py-3">
                              <div className="flex items-center gap-2 text-foreground">
                                {automation.lastRunStatus === 'error' ? (
                                  <Unplug className="h-4 w-4" />
                                ) : (
                                  <CheckCircle2 className="h-4 w-4" />
                                )}
                                <span className="font-medium">Son Durum</span>
                              </div>
                              <p className="mt-2">
                                Son koşu: {formatRelativeDate(automation.lastRunFinishedAt || automation.lastRunStartedAt)}
                              </p>
                              <p className="mt-1">Eklenen bölüm: {automation.lastAddedChapterCount}</p>
                              {automation.lastRunError ? (
                                <p className="mt-2 text-destructive">{automation.lastRunError}</p>
                              ) : null}
                            </div>

                            <div className="rounded-xl border border-border bg-muted/20 px-3 py-3">
                              <div className="flex items-center gap-2 text-foreground">
                                {automation.lastTestStatus === 'error' ? (
                                  <Unplug className="h-4 w-4" />
                                ) : (
                                  <ShieldCheck className="h-4 w-4" />
                                )}
                                <span className="font-medium">Son Test</span>
                              </div>
                              <p className="mt-2">
                                Durum: {getTestStatusLabel(automation.lastTestStatus)}
                              </p>
                              <p className="mt-1">Zaman: {formatRelativeTestDate(automation.lastTestedAt)}</p>
                              {automation.lastTestError ? (
                                <p className="mt-2 text-destructive">{automation.lastTestError}</p>
                              ) : null}
                            </div>
                          </div>

                          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="flex items-center gap-3">
                              <Switch
                                checked={automation.isActive}
                                onCheckedChange={(checked) => void handleToggleActive(automation, checked)}
                                disabled={isBusy}
                              />
                              <span className="text-sm text-muted-foreground">
                                {automation.isActive ? 'Aktif otomasyon' : 'Pasif otomasyon'}
                              </span>
                            </div>

                            <div className="flex flex-col gap-2 sm:flex-row">
                              <Button
                                variant="outline"
                                onClick={() => void handleTestAutomations([automation.id])}
                                disabled={isBusy || isTestingAll}
                              >
                                {isTesting ? (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="mr-2 h-4 w-4" />
                                )}
                                Test Et
                              </Button>
                              <Button variant="outline" onClick={() => startEditing(automation)} disabled={isBusy}>
                                Düzenle
                              </Button>
                              <Button
                                variant="outline"
                                className="text-destructive hover:text-destructive"
                                onClick={() => setPendingDeleteAutomation(automation)}
                                disabled={isBusy}
                              >
                                {isMutationBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                                Sil
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog
        open={Boolean(pendingDeleteAutomation)}
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeleteAutomation(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Otomasyonu Sil</AlertDialogTitle>
            <AlertDialogDescription>
              Bu kayıt silinirse zamanlama ve çalışma geçmişi kaldırılır. Manga bölümleri silinmez.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>İptal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Sil
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminAutomation;
