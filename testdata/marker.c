#include <windows.h>
int main(void){ HANDLE h=CreateFileA("C:\\TradingPlatform\\testdata\\marker_ran.txt",GENERIC_WRITE,0,0,CREATE_ALWAYS,FILE_ATTRIBUTE_NORMAL,0); if(h!=INVALID_HANDLE_VALUE){DWORD w; WriteFile(h,"ok",2,&w,0); CloseHandle(h);} return 0; }
