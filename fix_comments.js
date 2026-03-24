const fs = require('fs');
const path = 'c:/Users/Çağan/Desktop/Home/Sitelerim/toonparrot/src/components/comments/CommentSection.tsx';
let content = fs.readFileSync(path, 'utf8');

// Looking for exact block
const target = `{getReplies(reply.id).map((nestedReply) => (
                                                                                         <div key={nestedReply.id} className="rounded-lg border border-border/60 bg-background/30 p-3">
                                                                                             <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                                                                 <span className="font-medium text-foreground">{nestedReply.username}</span>
                                                                                                 <span>{formatDistanceToNow(new Date(nestedReply.createdAt), { addSuffix: true, locale: tr })}</span>
                                                                                             </div>
                                                                                             <p className="mt-1 text-sm leading-relaxed">
                                                                                                 {renderFormattedText(nestedReply.content)}
                                                                                             </p>
                                                                                         </div>
                                                                                     ))}`;

const replacement = `{getReplies(reply.id).map((nestedReply) => {
                                                                                         const isNRBlocked = (blockedUserIds || []).includes(nestedReply.userId);
                                                                                         const isNRRevealed = !!revealedBlockedComments[nestedReply.id];
                                                                                         
                                                                                         return (
                                                                                             <div key={nestedReply.id} className="relative rounded-lg border border-border/60 bg-background/30 p-3 overflow-hidden">
                                                                                                 <div className={cn("transition-all duration-300", isNRBlocked && !isNRRevealed && "blur-md select-none pointer-events-none grayscale opacity-40")}>
                                                                                                     <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                                                                         <span className="font-medium text-foreground">{nestedReply.username}</span>
                                                                                                         <span>{formatDistanceToNow(new Date(nestedReply.createdAt), { addSuffix: true, locale: tr })}</span>
                                                                                                     </div>
                                                                                                     <p className="mt-1 text-sm leading-relaxed">
                                                                                                         {renderFormattedText(nestedReply.content)}
                                                                                                     </p>
                                                                                                 </div>
                                                                                                 {isNRBlocked && !isNRRevealed && (
                                                                                                     <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/5 backdrop-blur-[1px]">
                                                                                                         <Button 
                                                                                                             size="sm" 
                                                                                                             variant="secondary" 
                                                                                                             className="h-6 text-[9px] font-bold px-2 py-0"
                                                                                                             onClick={() => setRevealedBlockedComments(prev => ({ ...prev, [nestedReply.id]: true }))}
                                                                                                         >
                                                                                                             Yanıtı Göster
                                                                                                         </Button>
                                                                                                     </div>
                                                                                                 )}
                                                                                             </div>
                                                                                         );
                                                                                     })}`;

// Replace multiple spaces and newlines for robustness
const normalize = (s) => s.replace(/\r/g, '').replace(/\s+/g, ' ').trim();

const targetNorm = normalize(target);
// Use a substring of the target to find the position
const keyPart = 'getReplies(reply.id).map((nestedReply) => (';
const keyPartStart = content.indexOf(keyPart);

if (keyPartStart !== -1) {
    // Find where the map ends
    const endPart = '))}';
    const keyPartEnd = content.indexOf(endPart, keyPartStart) + endPart.length;
    
    const originalPart = content.slice(keyPartStart, keyPartEnd);
    const newContent = content.slice(0, keyPartStart) + replacement + content.slice(keyPartEnd);
    fs.writeFileSync(path, newContent);
    console.log('Successfully updated CommentSection.tsx');
} else {
    console.error('Could not find target block');
}
