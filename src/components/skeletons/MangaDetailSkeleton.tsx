import { Skeleton } from "@/components/ui/skeleton";

const MangaDetailSkeleton = () => {
    return (
        <div className="min-h-screen bg-background">
            <div className="pt-16">
                {/* Hero Section Skeleton */}
                <div className="relative h-80 bg-background/50">
                    <Skeleton className="absolute inset-0 h-full w-full opacity-20" />
                </div>

                <div className="container relative z-10 -mt-64 py-8">
                    <div className="flex flex-col gap-6 md:flex-row md:gap-8">
                        {/* Cover Skeleton */}
                        <div className="shrink-0">
                            <Skeleton className="mx-auto h-72 w-48 rounded-xl md:h-96 md:w-64 shadow-2xl" />
                        </div>

                        {/* Info Skeleton */}
                        <div className="flex flex-1 flex-col gap-4 mt-8 md:mt-0">
                            <div className="flex gap-2">
                                <Skeleton className="h-6 w-16" />
                                <Skeleton className="h-6 w-20" />
                            </div>

                            <Skeleton className="h-10 w-3/4 max-w-lg" />
                            <Skeleton className="h-5 w-1/2" />

                            <div className="flex gap-4">
                                <Skeleton className="h-5 w-24" />
                                <Skeleton className="h-5 w-24" />
                                <Skeleton className="h-5 w-24" />
                            </div>

                            <Skeleton className="h-24 w-full" />

                            <div className="flex gap-2">
                                <Skeleton className="h-6 w-16" />
                                <Skeleton className="h-6 w-16" />
                                <Skeleton className="h-6 w-16" />
                            </div>

                            <div className="flex flex-wrap gap-3 pt-4">
                                <Skeleton className="h-12 w-32" />
                                <Skeleton className="h-12 w-32" />
                                <Skeleton className="h-12 w-32" />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Rating Section Skeleton */}
                <div className="container py-6">
                    <div className="rounded-xl border border-border bg-card/50 p-6">
                        <Skeleton className="h-7 w-24 mb-4" />
                        <div className="flex gap-4">
                            <Skeleton className="h-8 w-64" />
                            <Skeleton className="h-8 w-48" />
                        </div>
                    </div>
                </div>

                {/* Chapters List Skeleton */}
                <div className="container py-8">
                    <div className="rounded-xl border border-border bg-card/50">
                        <div className="border-b border-border p-4">
                            <Skeleton className="h-7 w-32 mb-2" />
                            <Skeleton className="h-4 w-24" />
                        </div>
                        <div className="divide-y divide-border">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="p-4 flex justify-between items-center">
                                    <div>
                                        <Skeleton className="h-5 w-48 mb-2" />
                                        <div className="flex gap-3">
                                            <Skeleton className="h-3 w-20" />
                                            <Skeleton className="h-3 w-16" />
                                        </div>
                                    </div>
                                    <Skeleton className="h-6 w-20" />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MangaDetailSkeleton;
