import { Skeleton } from "@/components/ui/skeleton";

const BrowseSkeleton = () => {
    return (
        <div className="min-h-screen bg-background">
            <div className="pt-20 container pb-12">
                {/* Title Skeleton */}
                <div className="mb-8">
                    <Skeleton className="h-10 w-32 mb-2" />
                    <Skeleton className="h-5 w-64" />
                </div>

                {/* Filters Bar Skeleton */}
                <div className="mb-6 flex flex-wrap items-center gap-4">
                    <div className="flex-1 min-w-[200px]">
                        <Skeleton className="h-10 w-full" />
                    </div>
                    <Skeleton className="h-10 w-32" />
                    <Skeleton className="h-10 w-36" />
                    <Skeleton className="h-10 w-36" />
                    <Skeleton className="h-10 w-24" />
                </div>

                {/* Results Count Skeleton */}
                <Skeleton className="h-5 w-24 mb-4" />

                {/* Manga Grid Skeleton */}
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                    {Array.from({ length: 12 }).map((_, i) => (
                        <div key={i} className="aspect-[3/4] rounded-xl overflow-hidden">
                            <Skeleton className="h-full w-full" />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default BrowseSkeleton;
