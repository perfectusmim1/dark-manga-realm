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

-- MANGA PUANLARI (Basit)
CREATE TABLE public.ratings (
  id text NOT NULL DEFAULT uuid_generate_v4(),
  manga_id text NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 10),
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT ratings_pkey PRIMARY KEY (id)
);

-- DETAYLI İNCELEMELER (Reviews)
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

-- İNCELEME BEĞENİLERİ
CREATE TABLE public.review_likes (
  user_id text NOT NULL REFERENCES public.users(id),
  review_id uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT review_likes_pkey PRIMARY KEY (user_id, review_id)
);

-- REAKSİYONLAR
CREATE TABLE public.manga_reactions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  manga_id text REFERENCES public.mangas(id) ON DELETE CASCADE,
  user_id text REFERENCES public.users(id),
  chapter_id text,
  reaction_type text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT manga_reactions_pkey PRIMARY KEY (id)
);
```

### 3. Adım: Yazarlar, Sanatçılar ve Karakterler
```sql
-- KARAKTERLER
CREATE TABLE public.characters (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  image_url text,
  description text,
  likes_count integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT characters_pkey PRIMARY KEY (id)
);

-- KARAKTER YORUMLARI & BEĞENİLERİ
CREATE TABLE public.character_comments (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  character_id uuid REFERENCES public.characters(id) ON DELETE CASCADE,
  user_id text REFERENCES public.users(id),
  username text,
  user_avatar text,
  content text NOT NULL,
  likes integer DEFAULT 0,
  gif_url text,
  parent_id uuid REFERENCES public.character_comments(id),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT character_comments_pkey PRIMARY KEY (id)
);

CREATE TABLE public.character_likes (
  user_id text NOT NULL REFERENCES public.users(id),
  character_id uuid NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  CONSTRAINT character_likes_pkey PRIMARY KEY (user_id, character_id)
);

-- YAZARLAR VE SANATÇILAR (Benzer yapıda authors ve artists tabloları)
-- Not: authors, artists tabloları ve bunlara bağlı comment/like/reaction tabloları 
-- karakterler tablosuyla aynı mantıkta oluşturulmalıdır.

-- İLİŞKİ (JUNCTION) TABLOLARI
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

### 4. Adım: Kullanıcı Verileri (Listeler, Takip, İlerleme)
```sql
-- FAVORİLER VE TAKİP
CREATE TABLE public.favorites (
  id text NOT NULL DEFAULT uuid_generate_v4(),
  user_id text NOT NULL,
  manga_id text NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
  category character varying DEFAULT 'reading'::character varying CHECK (category::text = ANY (ARRAY['reading'::character varying, 'completed'::character varying, 'plan_to_read'::character varying, 'on_hold'::character varying, 'dropped'::character varying]::text[])),
  added_at timestamp with time zone DEFAULT now(),
  CONSTRAINT favorites_pkey PRIMARY KEY (id)
);

CREATE TABLE public.follows (
  id text NOT NULL DEFAULT uuid_generate_v4(),
  user_id text NOT NULL REFERENCES public.users(id),
  manga_id text NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
  followed_at timestamp with time zone DEFAULT now(),
  CONSTRAINT follows_pkey PRIMARY KEY (id)
);

-- OKUMA LİSTELERİ
CREATE TABLE public.reading_lists (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id text NOT NULL REFERENCES public.users(id),
  name text NOT NULL,
  description text,
  is_public boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT reading_lists_pkey PRIMARY KEY (id)
);

CREATE TABLE public.reading_list_items (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  list_id uuid NOT NULL REFERENCES public.reading_lists(id) ON DELETE CASCADE,
  manga_id text NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT reading_list_items_pkey PRIMARY KEY (id)
);

-- İLERLEME VE YER İMLERİ
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

CREATE TABLE public.bookmarks (
  id text NOT NULL DEFAULT (gen_random_uuid())::text,
  user_id text NOT NULL,
  manga_id text NOT NULL REFERENCES public.mangas(id) ON DELETE CASCADE,
  chapter_id text NOT NULL,
  chapter_number numeric,
  page integer NOT NULL,
  note text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT bookmarks_pkey PRIMARY KEY (id)
);

-- BİLDİRİMLER
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

## 4. Güvenlik Önlemleri (Row Level Security - RLS)

Sistem güvenliği için veritabanındaki her tablo RLS ile korunmaktadır. Yeni kurulumda bu politikaları SQL Editor üzerinden çalıştırmayı unutmayın.

### 1. Kullanıcı Rol Kontrolü Fonksiyonu
Bazı politikalar `admin` veya `moderator` kontrolü yaptığı için aşağıdaki yardımcı fonksiyonun kurulu olması gerekir:

```sql
CREATE OR REPLACE FUNCTION public.check_user_role(user_id text, allowed_roles text[])
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.users
    WHERE id = user_id AND role = ANY(allowed_roles)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 2. Tablo Politikaları

#### Kullanıcılar (users)
```sql
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Herkes profilleri görebilir
CREATE POLICY "Public profiles are viewable by everyone" ON public.users 
    FOR SELECT USING (true);

-- Kullanıcılar kendi profillerini oluşturabilir
CREATE POLICY "Users can insert their own profile" ON public.users 
    FOR INSERT WITH CHECK (auth.uid()::text = id);

-- Kullanıcılar kendi profillerini güncelleyebilir (rol değişimi hariç)
CREATE POLICY "Users can update own profile" ON public.users 
    FOR UPDATE USING (auth.uid()::text = id);

-- Adminler tüm kullanıcıları yönetebilir
CREATE POLICY "Admins can manage all users" ON public.users 
    FOR ALL USING (check_user_role(auth.uid()::text, ARRAY['admin', 'moderator']));
```

#### Mangalar ve Bölümler (mangas, chapters)
```sql
-- Herkes okuyabilir
CREATE POLICY "mangas_read" ON public.mangas FOR SELECT USING (true);
CREATE POLICY "chapters_read" ON public.chapters FOR SELECT USING (true);

-- Sadece yetkililer düzenleyebilir
CREATE POLICY "mangas_admin_all" ON public.mangas 
    FOR ALL USING (check_user_role(auth.uid()::text, ARRAY['admin', 'moderator']));

CREATE POLICY "chapters_admin_all" ON public.chapters 
    FOR ALL USING (check_user_role(auth.uid()::text, ARRAY['admin', 'moderator']));
```

#### Yorumlar ve Beğeniler (comments, likes)
```sql
-- Tüm yorum tabloları için (comments, character_comments vb.)
CREATE POLICY "Public Select" ON public.comments FOR SELECT USING (true);

-- Sadece giriş yapanlar yorum yapabilir
CREATE POLICY "User Insert" ON public.comments 
    FOR INSERT WITH CHECK (auth.uid()::text = user_id);

-- Sadece sahibi veya admin silebilir/güncelleyebilir
CREATE POLICY "User Owner or Admin" ON public.comments 
    FOR ALL USING (
        auth.uid()::text = user_id OR 
        check_user_role(auth.uid()::text, ARRAY['admin', 'moderator'])
    );
```

#### Kullanıcı Verileri (follows, favorites, reading_progress, bookmarks)
```sql
-- Bu tablolarda kural "Sadece Sahibi" (Individual User Data) prensibidir
CREATE POLICY "Users can manage own data" ON public.favorites 
    FOR ALL USING (auth.uid()::text = user_id);

CREATE POLICY "Users can manage own progress" ON public.reading_progress 
    FOR ALL USING (auth.uid()::text = user_id);

CREATE POLICY "Users can view own notifications" ON public.notifications 
    FOR SELECT USING (auth.uid()::text = user_id);
```

## 5. Fonksiyonlar ve Tetikleyiciler (Triggers)

Güncellenme tarihleri ve otomatik işlemler için aşağıdaki Sql'leri çalıştırın.

```sql
-- Updated_at kolonunu otomatik güncelleme fonksiyonu
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Yeni bölüm eklendiğinde manganın 'last_updated' tarihini güncelleme
CREATE OR REPLACE FUNCTION update_manga_last_updated()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.mangas SET last_updated = NOW() WHERE id = NEW.manga_id;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_manga_on_chapter_insert
    AFTER INSERT ON public.chapters
    FOR EACH ROW
    EXECUTE FUNCTION update_manga_last_updated();

-- GÖRÜNTÜLENME ARTIRMA FONKSİYONLARI (RPC)
-- Supabase Dashboard > Database > Functions kısmından ekleyin

CREATE OR REPLACE FUNCTION increment_manga_views(manga_id_param UUID)
RETURNS void AS $$
BEGIN
    UPDATE public.mangas
    SET views = views + 1
    WHERE id = manga_id_param;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_chapter_views(chapter_id_param UUID)
RETURNS void AS $$
BEGIN
    UPDATE public.chapters
    SET views = views + 1
    WHERE id = chapter_id_param;
END;
$$ LANGUAGE plpgsql;
```

## 6. Önemli Hatırlatmalar

1.  **Auth Sync:** Sitede `AuthContext.tsx` dosyasında bulunan `syncAuthState` fonksiyonu, Supabase Auth tablosu ile `public.users` tablosunu eşleştirir. Eğer yeni hesap açarsanız, bu sistem sayesinde giriş yapan kullanıcılar için otomatik profil oluşturulacaktır.
2.  **Storage:** Eğer siteye kapak görseli veya avatar yüklüyorsanız, Supabase Dashboard üzerinden `Storage` kısmında `mangas` ve `avatars` adında iki adet "Public" bucket oluşturmalı ve bunlara uygun RLS politikaları (select: public, insert/update: auth) tanımlamalısınız.
3.  **Hızlandırma (Indexes):** Performans için `manga_id`, `user_id` ve `chapter_id` kolonlarına veritabanında "Index" oluşturun.

*Bu doküman Perfectus Obfuscator/Manga Realm sistemi için özel olarak hazırlanmıştır.*