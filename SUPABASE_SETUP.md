# Supabase Entegrasyon Rehberi - Dark Manga Realm

Bu dosya, sitenizin Supabase üzerindeki tüm yapılandırmalarını, şemalarını ve güvenlik ayarlarını içermektedir. Eğer ileride Supabase hesabınızı kaybederseniz, yeni bir projede bu ayarları kullanarak siteyi tekrar aktif hale getirebilirsiniz.

## 1. Proje Kurulumu ve Çevre Değişkenleri

Yeni bir Supabase projesi oluşturduktan sonra `.env` dosyanıza aşağıdaki değişkenleri eklemelisiniz:

```env
VITE_SUPABASE_URL=https://proje-id.supabase.co
VITE_SUPABASE_ANON_KEY=sizin-anon-anahtarınız
```

- **URL:** Project Settings > API > Project URL
- **ANON KEY:** Project Settings > API > Project API keys

## 2. Kimlik Doğrulama (Authentication) Yapılandırması

Siteniz hem E-posta hem de Google ile girişi desteklemektedir.

### E-posta Yapılandırması
`Authentication > Providers > Email` kısmından etkinleştirin. 
- "Confirm email" ayarı tercihinize bağlıdır. Kapalı olması kullanıcı deneyimini hızlandırır.

### Google OAuth Yapılandırması (Giriş Yapmak İçin Gereklidir)
`Authentication > Providers > Google` kısmından etkinleştirin.
- **Client ID** ve **Client Secret** bilgilerini Google Cloud Console üzerinden almalısınız.
- **Redirect URI:** Supabase paneli tarafından verilen URL'yi Google Cloud Console'a eklemeyi unutmayın.

## 3. Veritabanı Şeması (Database Schema)

Aşağıdaki SQL kodlarını sırasıyla Supabase **SQL Editor** üzerinden çalıştırın.

### 1. Adım: Temel Uzantılar ve Çekirdek Tablolar
```sql
-- Gerekli uzantıları etkinleştir
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- KULLANICILAR (Ana Tablo)
CREATE TABLE public.users (
  id text NOT NULL DEFAULT uuid_generate_v4(),
  username character varying NOT NULL UNIQUE,
  email character varying NOT NULL UNIQUE,
  password_hash character varying NOT NULL,
  avatar text,
  role character varying DEFAULT 'user'::character varying CHECK (role::text = ANY (ARRAY['user'::character varying, 'admin'::character varying, 'moderator'::character varying]::text[])),
  preferences jsonb DEFAULT '{"notifications": {"likes": true, "replies": true, "new_chapter": true}}'::jsonb,
  two_factor_enabled boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id)
);

-- ADMİN KULLANICILARI
CREATE TABLE public.admin_users (
  id text NOT NULL DEFAULT uuid_generate_v4(),
  username character varying NOT NULL UNIQUE,
  email character varying NOT NULL UNIQUE,
  password character varying NOT NULL,
  role character varying DEFAULT 'admin'::character varying CHECK (role::text = ANY (ARRAY['admin'::character varying, 'moderator'::character varying]::text[])),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT admin_users_pkey PRIMARY KEY (id)
);

-- MANGALAR
CREATE TABLE public.mangas (
  id text NOT NULL DEFAULT uuid_generate_v4(),
  title character varying NOT NULL,
  author character varying NOT NULL,
  artist character varying,
  description text NOT NULL,
  cover text NOT NULL,
  banner text,
  genres text[] DEFAULT '{}'::text[],
  status character varying DEFAULT 'ongoing'::character varying CHECK (status::text = ANY (ARRAY['ongoing'::character varying, 'completed'::character varying, 'hiatus'::character varying]::text[])),
  type character varying DEFAULT 'manga'::character varying CHECK (type::text = ANY (ARRAY['manga'::character varying, 'manhwa'::character varying, 'manhua'::character varying]::text[])),
  views integer DEFAULT 0,
  release_year integer,
  alternative_titles text[] DEFAULT '{}'::text[],
  created_at timestamp with time zone DEFAULT now(),
  last_updated timestamp with time zone DEFAULT now(),
  CONSTRAINT mangas_pkey PRIMARY KEY (id)
);

-- BÖLÜMLER
CREATE TABLE public.chapters (
  id text NOT NULL DEFAULT uuid_generate_v4(),
  manga_id text NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
  number numeric NOT NULL,
  title character varying,
  pages text[] DEFAULT '{}'::text[],
  views integer DEFAULT 0,
  release_date timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT chapters_pkey PRIMARY KEY (id)
);
```

### 2. Adım: Etkileşimler (Yorumlar, Beğeniler, Puanlar)
```sql
-- MANGA YORUMLARI
CREATE TABLE public.comments (
  id text NOT NULL DEFAULT uuid_generate_v4(),
  manga_id text NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
  chapter_id text,
  user_id text NOT NULL REFERENCES public.users(id),
  username text,
  user_avatar text,
  content text NOT NULL,
  gif_url text,
  parent_id text,
  likes integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone,
  CONSTRAINT comments_pkey PRIMARY KEY (id)
);

-- YORUM BEĞENİLERİ
CREATE TABLE public.comment_likes (
  id text NOT NULL DEFAULT uuid_generate_v4(),
  comment_id text NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT comment_likes_pkey PRIMARY KEY (id)
);

-- PUANLAR VE İNCELEMELER
CREATE TABLE public.ratings (
  id text NOT NULL DEFAULT uuid_generate_v4(),
  manga_id text NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 10),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT ratings_pkey PRIMARY KEY (id)
);

CREATE TABLE public.reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  manga_id text NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES public.users(id),
  content text NOT NULL,
  rating_story smallint NOT NULL CHECK (rating_story >= 1 AND rating_story <= 10),
  rating_characters smallint NOT NULL CHECK (rating_characters >= 1 AND rating_characters <= 10),
  rating_art smallint NOT NULL CHECK (rating_art >= 1 AND rating_art <= 10),
  rating_progression smallint NOT NULL CHECK (rating_progression >= 1 AND rating_progression <= 10),
  rating_engagement smallint NOT NULL CHECK (rating_engagement >= 1 AND rating_engagement <= 10),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT reviews_pkey PRIMARY KEY (id)
);

CREATE TABLE public.review_likes (
  user_id text NOT NULL REFERENCES public.users(id),
  review_id uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT review_likes_pkey PRIMARY KEY (user_id, review_id)
);
```

### 3. Adım: Yazarlar, Sanatçılar ve Karakterler
```sql
-- KARAKTERLER, YAZARLAR, SANATÇILAR
CREATE TABLE public.characters (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  image_url text,
  description text,
  likes_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT characters_pkey PRIMARY KEY (id)
);

CREATE TABLE public.authors (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  image_url text,
  description text,
  likes_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT authors_pkey PRIMARY KEY (id)
);

CREATE TABLE public.artists (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  image_url text,
  description text,
  likes_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT artists_pkey PRIMARY KEY (id)
);

-- JUNCTION TABLOLARI
CREATE TABLE public.manga_characters (
  manga_id text NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  CONSTRAINT manga_characters_pkey PRIMARY KEY (manga_id, character_id)
);

CREATE TABLE public.manga_authors (
  manga_id text NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES public.authors(id) ON DELETE CASCADE,
  CONSTRAINT manga_authors_pkey PRIMARY KEY (manga_id, author_id)
);

CREATE TABLE public.manga_artists (
  manga_id text NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
  artist_id uuid NOT NULL REFERENCES public.artists(id) ON DELETE CASCADE,
  CONSTRAINT manga_artists_pkey PRIMARY KEY (manga_id, artist_id)
);
```

### 4. Adım: Reaksiyonlar ve Yorumlar (Detaylı)
```sql
-- Reaksiyon tabloları
CREATE TABLE public.manga_reactions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  manga_id text REFERENCES public.mangas(id) ON DELETE CASCADE,
  user_id text REFERENCES public.users(id),
  chapter_id text,
  reaction_type text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT manga_reactions_pkey PRIMARY KEY (id)
);

-- Benzer tablolar: author_reactions, artist_reactions, character_reactions (Primary Key: id uuid)
-- Benzer tablolar: character_comments, author_comments, artist_comments
-- Benzer tablolar: character_likes, author_likes, artist_likes
```

### 5. Adım: Kullanıcı Verileri (Listeler, Takip, İlerleme)
```sql
CREATE TABLE public.favorites (
  id text NOT NULL DEFAULT uuid_generate_v4(),
  user_id text NOT NULL,
  manga_id text NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
  category character varying DEFAULT 'reading'::character varying CHECK (category::text = ANY (ARRAY['reading'::character varying, 'completed'::character varying, 'plan_to_read'::character varying, 'on_hold'::character varying, 'dropped'::character varying]::text[])),
  added_at timestamp with time zone DEFAULT now(),
  CONSTRAINT favorites_pkey PRIMARY KEY (id)
);

CREATE TABLE public.reading_progress (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  user_id text NOT NULL,
  manga_id text NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
  chapter_id text NOT NULL,
  chapter_number numeric,
  page integer DEFAULT 1,
  last_read timestamp with time zone DEFAULT now(),
  CONSTRAINT reading_progress_pkey PRIMARY KEY (id)
);

CREATE TABLE public.notifications (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  user_id text NOT NULL,
  type character varying NOT NULL,
  title character varying NOT NULL,
  message text NOT NULL,
  link text,
  read boolean DEFAULT false,
  manga_id text,
  chapter_id text,
  chapter_number numeric,
  from_user_id text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id)
);
```

## 4. Performans ve Güvenlik Optimizasyonları

Sitenin hızlı çalışması ve güvenli kalması için aşağıdaki ayarlar uygulanmıştır.

### 1. İndeksleme (Hızlandırma)
Sorguların milisaniyeler içinde yanıt vermesi için şu indeksleri oluşturun:
```sql
-- Manga & Bölüm İndeksleri
CREATE INDEX IF NOT EXISTS idx_comments_manga_id ON public.comments(manga_id);
CREATE INDEX IF NOT EXISTS idx_comments_chapter_id ON public.comments(chapter_id);
CREATE INDEX IF NOT EXISTS idx_reading_progress_manga_id ON public.reading_progress(manga_id);

-- Kullanıcı İndeksleri
CREATE INDEX IF NOT EXISTS idx_comments_user_id ON public.comments(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON public.favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);

-- Gelişmiş İndeksler (Reaksiyonlar ve İncelemeler)
CREATE INDEX IF NOT EXISTS idx_manga_reactions_manga_id ON public.manga_reactions(manga_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id ON public.reviews(user_id);
```

### 2. Sertleştirilmiş Güvenlik (RLS)
Sorgu performansını artıran ve güvenliği sıkılaştıran politikalar:

```sql
-- YÜKSEK PERFORMANSLI RLS KALIBI: (SELECT auth.uid()) kullanımı
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public profiles are viewable" ON public.users 
    FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON public.users 
    FOR UPDATE USING ((SELECT auth.uid())::text = id);

-- BİLDİRİMLER: Sadece gönderici bildirim oluşturabilir
CREATE POLICY "Strict Notification Insert" ON public.notifications
    FOR INSERT TO authenticated
    WITH CHECK ((SELECT auth.uid())::text = from_user_id);
```

## 5. Fonksiyonlar ve Tetikleyiciler (Triggers)

```sql
-- GÖRÜNTÜLENME ARTIRMA (RPC)
CREATE OR REPLACE FUNCTION increment_manga_views(manga_id_param text)
RETURNS void AS $$
BEGIN
    UPDATE public.mangas SET views = views + 1 WHERE id = manga_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION increment_chapter_views(chapter_id_param text)
RETURNS void AS $$
BEGIN
    UPDATE public.chapters SET views = views + 1 WHERE id = chapter_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ROL KONTROLÜ
CREATE OR REPLACE FUNCTION public.check_user_role(target_id text, required_roles text[])
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users WHERE id = target_id AND role = ANY(required_roles)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
```

## 6. Önemli Hatırlatmalar

1.  **Storage:** `mangas` ve `avatars` adında iki adet "Public" bucket oluşturun.
2.  **Auth Sync:** `AuthContext.tsx` içindeki `syncAuthState` fonksiyonu yeni üyeler için `public.users` tablosunda otomatik profil oluşturur.
3.  **Leaked Password:** Supabase Dashboard > Auth > Settings > "Leaked Password Protection" ayarını **AÇIK** hale getirin.

*Bu doküman ToonParrot / Manga Realm sistemi için güncellenmiş ve optimize edilmiştir.*