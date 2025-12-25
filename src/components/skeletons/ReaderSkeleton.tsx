import { Skeleton } from "@/components/ui/skeleton";

const ReaderSkeleton = () => {
    return (
        <div className="min-h-screen bg-background relative">
            {/* Top Bar Skeleton */}
            <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between p-4 bg-background/80 backdrop-blur-md border-b border-border">
                <Skeleton className="h-8 w-8" />
                <div className="flex flex-col items-center">
                    <Skeleton className="h-4 w-32 mb-1" />
                    <Skeleton className="h-3 w-20" />
                </div>
                <div className="flex gap-2">
                    <Skeleton className="h-8 w-8" />
                    <Skeleton className="h-8 w-8" />
                </div>
            </div>

            {/* Reader Content Skeleton */}
            <div className="pt-20 pb-20 container max-w-3xl">
                {/* Simulate a few pages */}
                <Skeleton className="w-full aspect-[2/3] mb-4" />
                <Skeleton className="w-full aspect-[2/3] mb-4" />
            </div>

            {/* Bottom Bar Skeleton */}
            <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-background/80 backdrop-blur-md border-t border-border flex justify-center">
                <Skeleton className="h-10 w-full max-w-md" />
            </div>
        </div>
    );
};

export default ReaderSkeleton;
