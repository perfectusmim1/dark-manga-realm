import { BookOpen, MessageSquare, Trophy, Star, Book, Flame } from 'lucide-react';

export interface AchievementConfig {
    id: string;
    title: string;
    description: string;
    icon: any; // Lucide icon
    color: string;
    bgColor: string;
    maxProgress: number;
}

export const ACHIEVEMENTS: Record<string, AchievementConfig> = {
    first_blood: {
        id: 'first_blood',
        title: 'İlk Kan',
        description: 'İlk bölümünü okudun.',
        icon: Flame,
        color: 'text-orange-500',
        bgColor: 'bg-orange-500/20',
        maxProgress: 1
    },
    manga_worm: {
        id: 'manga_worm',
        title: 'Manga Kurdu',
        description: '100 bölüm okudun.',
        icon: Trophy,
        color: 'text-yellow-500',
        bgColor: 'bg-yellow-500/20',
        maxProgress: 100
    },
    critic: {
        id: 'critic',
        title: 'Eleştirmen',
        description: '50 yorum yaptın.',
        icon: MessageSquare,
        color: 'text-blue-500',
        bgColor: 'bg-blue-500/20',
        maxProgress: 50
    },
    explorer: {
        id: 'explorer',
        title: 'Kaşif',
        description: '10 farklı seriye başladın.',
        icon: Book,
        color: 'text-green-500',
        bgColor: 'bg-green-500/20',
        maxProgress: 10
    },
    veteran: {
        id: 'veteran',
        title: 'Kıdemli Okuyucu',
        description: '1000 bölüm devirdin!',
        icon: Star,
        color: 'text-purple-500',
        bgColor: 'bg-purple-500/20',
        maxProgress: 1000
    }
};
