#include "ReflectiveLoader.h"
#include <windows.h>
#include <QDir>
#include <cstring>

namespace {

struct PELayout {
    PIMAGE_DOS_HEADER dos = nullptr;
    PIMAGE_NT_HEADERS64 nt = nullptr;
    PIMAGE_SECTION_HEADER sections = nullptr;
    quintptr imageBase = 0;
    quintptr allocated = 0;
    quintptr delta = 0;
    DWORD sizeOfImage = 0;
};

bool fail(QString* error, const QString& msg) {
    if (error) *error = msg;
    return false;
}

bool applyRelocations(PELayout& pe, QString* error) {
    if (pe.delta == 0) return true;
    auto* dir = &pe.nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_BASERELOC];
    if (dir->VirtualAddress == 0 || dir->Size == 0)
        return fail(error, QStringLiteral("Image requires relocation but has none"));
    auto* reloc = reinterpret_cast<PIMAGE_BASE_RELOCATION>(pe.allocated + dir->VirtualAddress);
    auto* end = reinterpret_cast<BYTE*>(reloc) + dir->Size;
    while (reinterpret_cast<BYTE*>(reloc) < end && reloc->SizeOfBlock >= sizeof(IMAGE_BASE_RELOCATION)) {
        DWORD count = (reloc->SizeOfBlock - sizeof(IMAGE_BASE_RELOCATION)) / sizeof(WORD);
        auto* entries = reinterpret_cast<PWORD>(reinterpret_cast<BYTE*>(reloc) + sizeof(IMAGE_BASE_RELOCATION));
        for (DWORD i = 0; i < count; ++i) {
            WORD type = entries[i] >> 12;
            WORD offset = entries[i] & 0x0FFF;
            if (type == IMAGE_REL_BASED_ABSOLUTE) continue;
            if (type == IMAGE_REL_BASED_DIR64) {
                auto* patch = reinterpret_cast<quintptr*>(pe.allocated + reloc->VirtualAddress + offset);
                *patch += pe.delta;
            } else if (type == IMAGE_REL_BASED_HIGHLOW) {
                auto* patch = reinterpret_cast<DWORD*>(pe.allocated + reloc->VirtualAddress + offset);
                *patch += static_cast<DWORD>(pe.delta);
            } else {
                return fail(error, QStringLiteral("Unsupported relocation type %1").arg(type));
            }
        }
        reloc = reinterpret_cast<PIMAGE_BASE_RELOCATION>(reinterpret_cast<BYTE*>(reloc) + reloc->SizeOfBlock);
    }
    return true;
}

bool resolveImports(PELayout& pe, QString* error) {
    auto* dir = &pe.nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT];
    if (dir->VirtualAddress == 0) return true;
    auto* desc = reinterpret_cast<PIMAGE_IMPORT_DESCRIPTOR>(pe.allocated + dir->VirtualAddress);
    for (; desc->Name != 0; ++desc) {
        const char* dllName = reinterpret_cast<const char*>(pe.allocated + desc->Name);
        HMODULE mod = LoadLibraryA(dllName);
        if (!mod) return fail(error, QStringLiteral("Failed to load dependency %1").arg(QString::fromLatin1(dllName)));
        auto* origThunk = reinterpret_cast<PIMAGE_THUNK_DATA64>(pe.allocated + (desc->OriginalFirstThunk ? desc->OriginalFirstThunk : desc->FirstThunk));
        auto* thunk = reinterpret_cast<PIMAGE_THUNK_DATA64>(pe.allocated + desc->FirstThunk);
        for (; origThunk->u1.AddressOfData != 0; ++origThunk, ++thunk) {
            FARPROC fn = nullptr;
            if (origThunk->u1.Ordinal & IMAGE_ORDINAL_FLAG64) {
                fn = GetProcAddress(mod, reinterpret_cast<LPCSTR>(origThunk->u1.Ordinal & 0xFFFF));
            } else {
                auto* imp = reinterpret_cast<PIMAGE_IMPORT_BY_NAME>(pe.allocated + origThunk->u1.AddressOfData);
                fn = GetProcAddress(mod, reinterpret_cast<LPCSTR>(imp->Name));
            }
            if (!fn) {
                return fail(error, QStringLiteral("Unresolved import in %1").arg(QString::fromLatin1(dllName)));
            }
            thunk->u1.Function = reinterpret_cast<ULONGLONG>(fn);
        }
    }
    return true;
}

void protectSections(PELayout& pe) {
    for (WORD i = 0; i < pe.nt->FileHeader.NumberOfSections; ++i) {
        auto& s = pe.sections[i];
        DWORD protect = PAGE_READONLY;
        bool exec = (s.Characteristics & IMAGE_SCN_MEM_EXECUTE) != 0;
        bool write = (s.Characteristics & IMAGE_SCN_MEM_WRITE) != 0;
        if (exec && write) protect = PAGE_EXECUTE_READWRITE;
        else if (exec) protect = PAGE_EXECUTE_READ;
        else if (write) protect = PAGE_READWRITE;
        DWORD old = 0;
        if (s.Misc.VirtualSize)
            VirtualProtect(reinterpret_cast<LPVOID>(pe.allocated + s.VirtualAddress), s.Misc.VirtualSize, protect, &old);
    }
}

DWORD WINAPI entryThunk(LPVOID param) {
    auto entry = reinterpret_cast<int (*)()>(param);
    entry();
    return 0;
}

}

bool ReflectiveLoader::loadAndRun(const QByteArray& peData, const QString& workingDir, QString* error) {
    if (peData.size() < static_cast<int>(sizeof(IMAGE_DOS_HEADER)))
        return fail(error, QStringLiteral("Payload too small"));
    PELayout pe;
    pe.dos = reinterpret_cast<PIMAGE_DOS_HEADER>(const_cast<char*>(peData.constData()));
    if (pe.dos->e_magic != IMAGE_DOS_SIGNATURE)
        return fail(error, QStringLiteral("Invalid DOS signature"));
    if (pe.dos->e_lfanew <= 0 || pe.dos->e_lfanew + static_cast<int>(sizeof(IMAGE_NT_HEADERS64)) > peData.size())
        return fail(error, QStringLiteral("Invalid PE header offset"));
    pe.nt = reinterpret_cast<PIMAGE_NT_HEADERS64>(const_cast<char*>(peData.constData()) + pe.dos->e_lfanew);
    if (pe.nt->Signature != IMAGE_NT_SIGNATURE)
        return fail(error, QStringLiteral("Invalid NT signature"));
    if (pe.nt->FileHeader.Machine != IMAGE_FILE_MACHINE_AMD64)
        return fail(error, QStringLiteral("Payload is not a 64-bit executable"));
    if (pe.nt->OptionalHeader.Magic != IMAGE_NT_OPTIONAL_HDR64_MAGIC)
        return fail(error, QStringLiteral("Payload is not PE32+"));
    if (pe.nt->FileHeader.NumberOfSections == 0 || pe.nt->FileHeader.NumberOfSections > 96)
        return fail(error, QStringLiteral("Invalid section count"));

    pe.sizeOfImage = pe.nt->OptionalHeader.SizeOfImage;
    pe.imageBase = static_cast<quintptr>(pe.nt->OptionalHeader.ImageBase);
    pe.sections = IMAGE_FIRST_SECTION(pe.nt);

    auto* mem = VirtualAlloc(reinterpret_cast<LPVOID>(pe.imageBase), pe.sizeOfImage,
                             MEM_RESERVE | MEM_COMMIT, PAGE_EXECUTE_READWRITE);
    if (mem) {
        pe.allocated = reinterpret_cast<quintptr>(mem);
        pe.delta = 0;
    } else {
        mem = VirtualAlloc(nullptr, pe.sizeOfImage, MEM_RESERVE | MEM_COMMIT, PAGE_EXECUTE_READWRITE);
        if (!mem) return fail(error, QStringLiteral("Unable to allocate image memory"));
        pe.allocated = reinterpret_cast<quintptr>(mem);
        pe.delta = pe.allocated - pe.imageBase;
    }

    std::memset(reinterpret_cast<void*>(pe.allocated), 0, pe.sizeOfImage);
    DWORD headersSize = pe.nt->OptionalHeader.SizeOfHeaders;
    if (headersSize > static_cast<DWORD>(peData.size())) headersSize = peData.size();
    std::memcpy(reinterpret_cast<void*>(pe.allocated), peData.constData(), headersSize);

    for (WORD i = 0; i < pe.nt->FileHeader.NumberOfSections; ++i) {
        auto& s = pe.sections[i];
        if (s.SizeOfRawData == 0) continue;
        DWORD raw = s.SizeOfRawData;
        if (s.PointerToRawData + raw > static_cast<DWORD>(peData.size()))
            raw = peData.size() - s.PointerToRawData;
        if (s.VirtualAddress + raw > pe.sizeOfImage)
            return fail(error, QStringLiteral("Section exceeds image bounds"));
        std::memcpy(reinterpret_cast<void*>(pe.allocated + s.VirtualAddress),
                    peData.constData() + s.PointerToRawData, raw);
    }

    if (!applyRelocations(pe, error)) return false;
    if (!resolveImports(pe, error)) return false;
    protectSections(pe);

    if (!workingDir.isEmpty()) SetCurrentDirectoryW(reinterpret_cast<LPCWSTR>(workingDir.utf16()));

    quintptr entry = pe.allocated + pe.nt->OptionalHeader.AddressOfEntryPoint;
    FlushInstructionCache(GetCurrentProcess(), reinterpret_cast<LPCVOID>(pe.allocated), pe.sizeOfImage);
    HANDLE th = CreateThread(nullptr, 0, entryThunk, reinterpret_cast<LPVOID>(entry), 0, nullptr);
    if (!th) return fail(error, QStringLiteral("Failed to start payload thread"));
    CloseHandle(th);
    return true;
}
