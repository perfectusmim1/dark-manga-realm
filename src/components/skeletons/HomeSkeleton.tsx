import { Skeleton } from "@/components/ui/skeleton";

const SectionHeaderSkeleton = ({ wide = false }: { wide?: boolean }) => (
    <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5 rounded-full" />
            <Skeleton className={`h-7 ${wide ? 'w-56' : 'w-44'}`} />
        </div>
        <Skeleton className="h-8 w-24 rounded-md" />
    </div>
);

const PosterGridSkeleton = ({ count }: { count: number }) => (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8">
        {Array.from({ length: count }).map((_, index) => (
            <div key={index} className="space-y-2">
                <Skeleton className="aspect-[3/4] w-full rounded-xl" />
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-2/5" />
            </div>
        ))}
    </div>
);

const HomeSkeleton = () => {
    return (
        <div className="min-h-screen bg-background">
            <div className="container pb-12 pt-20">
                <section className="py-12">
                    <div className="mb-2 flex flex-col justify-between gap-6 px-4 sm:px-10 lg:flex-row lg:items-end lg:px-16">
                        <div className="space-y-3">
                            <div className="flex items-center gap-3">
                                <Skeleton className="h-6 w-14 rounded-md" />
                                <Skeleton className="h-12 w-80 max-w-full" />
                            </div>
                            <Skeleton className="h-4 w-56" />
                        </div>

                        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 p-1">
                            <Skeleton className="h-11 w-24 rounded-full" />
                            <Skeleton className="h-11 w-24 rounded-full" />
                            <Skeleton className="h-11 w-36 rounded-full" />
                        </div>
                    </div>

                    <div className="flex gap-4 overflow-hidden px-4 pb-20 pt-16 sm:gap-6 sm:px-10 lg:px-16">
                        {Array.from({ length: 6 }).map((_, index) => (
                            <div key={index} className="relative shrink-0 w-[calc((100%-16px)/2.3)] sm:w-[calc((100%-120px)/5)]">
                                <span
                                    className="pointer-events-none absolute -left-6 top-[-4.75rem] z-10 text-[8rem] font-black leading-none text-transparent opacity-60 sm:-left-8 sm:top-[-6.5rem] sm:text-[11rem]"
                                    style={{
                                        WebkitTextStroke: '3px rgba(255,255,255,0.18)',
                                    }}
                                >
                                    {index + 1}
                                </span>
                                <Skeleton className="aspect-[2/3] w-full rounded-xl" />
                            </div>
                        ))}
                    </div>
                </section>

                <section className="mt-10">
                    <SectionHeaderSkeleton wide />
                    <PosterGridSkeleton count={8} />
                </section>

                <section className="mt-10">
                    <SectionHeaderSkeleton />
                    <PosterGridSkeleton count={8} />
                </section>

                <section className="mt-12">
                    <SectionHeaderSkeleton />
                    <PosterGridSkeleton count={8} />
                </section>

                <section className="mt-16">
                    <div className="mb-6 flex items-center gap-2">
                        <Skeleton className="h-5 w-5 rounded-full" />
                        <Skeleton className="h-8 w-44" />
                        <Skeleton className="h-5 w-20 rounded-full" />
                    </div>
                    <div className="flex flex-wrap gap-2.5 rounded-2xl border border-border bg-card/30 p-8">
                        {Array.from({ length: 14 }).map((_, index) => (
                            <Skeleton
                                key={index}
                                className="h-8 rounded-full"
                                style={{ width: `${64 + (index % 5) * 18}px` }}
                            />
                        ))}
                    </div>
                </section>
            </div>
        </div>
    );
};

export default HomeSkeleton;
