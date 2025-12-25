import { Skeleton } from "@/components/ui/skeleton";

const ListSkeleton = () => {
    return (
        <div className="min-h-screen bg-background">
            <div className="pt-20 container pb-12">
                <div className="mb-8">
                    <Skeleton className="h-10 w-48 mb-2" />
                    <Skeleton className="h-5 w-64" />
                </div>

                <div className="space-y-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="flex gap-4 rounded-xl border border-border bg-card/50 p-4">
                            <Skeleton className="h-24 w-16 rounded-lg shrink-0" />
                            <div className="flex flex-1 flex-col justify-between">
                                <div>
                                    <Skeleton className="h-6 w-1/2 mb-2" />
                                    <Skeleton className="h-4 w-1/3 mb-2" />
                                </div>
                                <div className="flex justify-between items-center">
                                    <Skeleton className="h-5 w-24" />
                                    <div className="flex gap-2">
                                        <Skeleton className="h-9 w-24" />
                                        <Skeleton className="h-9 w-9" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default ListSkeleton;
