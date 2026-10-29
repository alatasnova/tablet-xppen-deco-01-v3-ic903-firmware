# XP-Pen Deco 01 V3 (Rev B / IC903) — Custom Firmware Reverse Engineering

Проект по reverse-инжинирингу и разработке кастомной прошивки для графического планшета **XP-Pen Deco 01 V3** с чипсетом **IC903** (в каталогах прошивок обозначается как **Deco 01 V3 Rev B**).

**Основная цель**: Повышение частоты опроса пера (report rate / polling rate) со штатных 250 Hz до 500 Hz / 1000 Hz и опциональное отключение сглаживания координат (unfiltered / no-smoothing).

---

## ⚠️ Безопасность и правила модификации

> **USE AT YOUR OWN RISK.** Неправильная прошивка может окирпичить планшет. 
> 
> * **Главное правило**: Модифицировать разрешено **ТОЛЬКО** секцию `code` (`ic903-code.bin`).
> * Загрузчик (`bootloader.bin`) и страница состояния (`state-page.bin`) **не должны изменяться**.
> * Перед любой операцией записи убедитесь, что сохранён полный верифицированный бэкап оригинальной прошивки.

---

## Архитектура микроконтроллера и прошивки IC903

Прошивка исследована на уровне машинного кода и векторов прерываний:

* **Процессорное ядро**: **ARM Cortex-M** (набор инструкций Thumb-2), Little-Endian.
* **Начальный стек (Initial SP)**: `0x200012D8` (ОЗУ / SRAM начинается с `0x20000000`).
* **Векторы прерываний (Vector Table)**:
  * `0x00006000`: Начальный Stack Pointer (`0x200012D8`)
  * `0x00006004`: Reset Handler (`0x00006161` -> адрес выполнения `0x00006160`, Thumb mode bit +1)
  * `0x00006008`: NMI Handler (`0x00006193`)
  * `0x0000600C`: HardFault Handler (`0x00006145`)
* **Базовый адрес секции приложения (`code`)**: **`0x00006000`**.
* **Периферийные регистры (MMIO)**: начинаются с `0x40000000` (стандартная карта ARM Cortex-M: таймеры, USB HID контроллер, GPIO, ADC).

### Карта памяти (Flash Memory Map)

| Диапазон адресов | Размер | Файл | Назначение |
|---|---|---|---|
| `0x00000000 - 0x00002FFF` | 12 КБ (12 288 B) | `ic903-bootloader.bin` | Неизменяемый DFU загрузчик (Bootloader) |
| `0x00003000 - 0x00005FFF` | 12 КБ | — | Зарезервировано / страницы состояния |
| **`0x00006000 - 0x0001F7FF`** | **~102 КБ (104 448 B)** | **`ic903-code.bin`** | **Основной код прошивки (ЕДИНСТВЕННЫЙ файл для модификации)** |
| `0x00000000 - 0x00020000` | 128 КБ (131 072 B) | `ic903-main.bin` | Полный образ основной Flash-памяти |

---

## Локализация USB HID дескрипторов в `ic903-code.bin`

В стоковой прошивке IC903 частота опроса ограничена параметром `bInterval = 4` (интервал передачи 4 мс = 250 Hz). Таблица дескрипторов найдена по следующим адресам:

| Дескриптор | Смещение в `.bin` | Адрес в памяти | Тип | Текущее значение bInterval |
|---|---|---|---|---|
| **Endpoint 1** | `0x0000BFB0` | `0x00011FB0` | Interrupt IN (0x81, MaxPkt 8) | Байт `0xBFB6` = **`0x04`** (4 ms) |
| **Endpoint 2** | `0x0000BFC9` | `0x00011FC9` | Interrupt IN (0x82, MaxPkt 64) | Байт `0xBFCF` = **`0x04`** (4 ms) |
| **Endpoint 3** | `0x0000BFE2` | `0x00011FE2` | Interrupt IN (0x83, MaxPkt 12) | Байт `0xBFE8` = **`0x04`** (4 ms) |
| **Endpoint 2** | `0x0000BFFB` | `0x00011FFB` | Interrupt OUT (0x02, MaxPkt 64) | Байт `0xC001` = **`0x04`** (4 ms) |

> 💡 **Для частоты 500 Hz**: значение `bInterval` меняется с `0x04` на `0x02` (или `0x01` для 1000 Hz). Дополнительно необходимо скорректировать связанные таймеры сканирования матрицы пера.

---

## Структура репозитория

```
tablet-reverse-engeneering/
├── README.md                      # Данный документ — единая инструкция для разработчика и агента
├── tools/                         # Все необходимые бинарные инструменты
│   ├── xppen-tools.exe            # Утилита DFU/прошивки (NiceAesth builds)
│   └── ghidra/                    # Установленный дистрибутив Ghidra 12.x
├── original_firmware_dump/        # Оригинальный стоковый дамп Deco 01 V3 Rev B (IC903)
│   ├── ic903-bootloader.bin       # Загрузчик (НЕ ТРОГАТЬ)
│   ├── ic903-code.bin             # Редактируемый код приложения
│   ├── ic903-main.bin             # Полный флеш
│   ├── ic903-state-page.bin       # Страница состояния
│   └── ic903-stock.hex            # Оригинальный Intel HEX
├── ic902-firmware/                # Материалы ревизии IC902 (для сравнительного анализа)
│   ├── stock/                     # Стоковые дампы IC902 (ic902-code.bin, ic902-stock.hex)
│   └── patched/                   # Рабочие патчи IC902 от NiceAesth (500hz.hex, stock-no-smoothing.hex)
└── custom_firmware/               # Папка для результатов патчинга IC903 (.bin и .hex)
```

---

## Подключение Ghidra и REA MCP

В системе уже настроен локальный MCP-сервер **REA (Reverse Engineer Anything)**:
* **Java JDK**: `C:\Program Files\Java\jdk-25` (`JAVA_HOME` задан).
* **Ghidra**: `E:\Coding\tablet-reverse-engeneering\tools\ghidra` (`GHIDRA_INSTALL_DIR` задан).
* **Конфиг MCP**: `C:\Users\alta_s\.gemini\config\mcp_config.json`.

### Параметры для открытия прошивки агентом через MCP (`open_binary`):
```json
{
  "path": "E:\\Coding\\tablet-reverse-engeneering\\original_firmware_dump\\ic903-code.bin",
  "format": "raw-binary",
  "architecture": "arm",
  "entry_point": "0x6000",
  "provider_id": "ghidra"
}
```

---

## Быстрые команды работы с планшетом (`xppen-tools`)

Инструмент находится в папке `.\tools\xppen-tools.exe`. Основные сценарии:

```powershell
# 1. Проверить статус подключённого планшета
.\tools\xppen-tools.exe info

# 2. Мониторинг координат и текущей частоты опроса в реальном времени
.\tools\xppen-tools.exe monitor

# 3. Перевести планшет в DFU-режим для прошивки
.\tools\xppen-tools.exe dfu

# 4. Сделать бэкап текущего состояния устройства
.\tools\xppen-tools.exe dump backup

# 5. Собрать Intel HEX из модифицированного ic903-code.bin (с базой 0x6000):
.\tools\xppen-tools.exe ihex custom_firmware\ic903-code-patched.bin --ic 903 -o custom_firmware\ic903-500hz.hex

# 6. Записать новую прошивку в планшет:
.\tools\xppen-tools.exe update custom_firmware\ic903-500hz.hex

# 7. Выйти из DFU режима (если прошивка не выполнялась):
.\tools\xppen-tools.exe exit-dfu
```

---

## План действий для реверс-инжиниринга

1. **Сравнение патча IC902**:
   * Изучить диффы между `ic902-firmware/stock/ic902-stock.hex` и `ic902-firmware/patched/500hz.hex`.
   * Изменения в IC902 включают правку `bInterval` в дескрипторах и деление таймеров опроса сенсора.
2. **Перенос на IC903**:
   * Дескрипторы `bInterval` уже локализованы по смещениям `0xBFB0..0xC001`.
   * Найти в `ic903-code.bin` код инициализации аппаратного таймера и обработчик прерывания АЦП/сенсора (сравнивая логику функций с аналогичными процедурами в Ghidra для IC902).
3. **Сборка и проверка**:
   * Сформировать `ic903-code-patched.bin`.
   * Сконвертировать в HEX: `.\tools\xppen-tools.exe ihex ... --ic 903`.
   * Зашить через `update` и замерить частоту с помощью `.\tools\xppen-tools.exe monitor`.
