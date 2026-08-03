# TaqMan CNV Plate Planner

与 qPCR 板布局规划工具同系列的 TaqMan Copy Number Variation（CNV）技术人员工具。

## 功能

- 96/384 孔板；复孔默认从左到右连续排列，不跨行。
- 官方 duplex：每个 FAM target 分别与 VIC reference 同孔。
- 自建 multiplex：多个 target 与 reference 同孔，检查 reporter 是否重复。
- Assay ID 默认为空且允许留空；multiplex 同孔 Reporter 重复时实时标红并阻止生成。
- Calibrator、NTC、0/1/2-copy QC 自动在每块板重复。
- 默认加样方式显示为“八道排枪各行上样”；384 孔仍可切换 9 mm 八道隔行上样。
- 默认 10.0 µL/孔反应体系，自动补水并按反应组计算 10% 配液余量。
- Excel 导出包含板图、孔明细、反应体系、Assay/Reporter 配置，以及与 `PCR-96-new.xlsx`、`PCR-384.xlsx` 一致的 `Well + Sample` 仪器粘贴列表。
- 页面结构与 qPCR 板布局工具保持一致：左侧实验输入、中间板图、右侧粘性反应体系栏；384 孔板仅在板图容器内横向滚动，并支持中文 / English 一键切换。
- 当前板支持复制 `Well + Sample` 含表头或无表头两种格式，界面内提供 QuantStudio/SDS 粘贴用途说明。
- 所有实验数据仅在当前浏览器本地处理；显式保存到 `localStorage`。

## 运行

```bash
npm install
npm run dev
```

生产构建与测试：

```bash
npm test
```

## 科学边界

本工具仅供科研使用（RUO）。标准 TaqMan Copy Number workflow 是 target + reference duplex。GSTM1-FAM / GSTT1-CY5 / RNase P-VIC 三色方法属于本地自建 multiplex，正式使用前必须确认 assay ID、浓度、reporter、quencher、仪器通道及光谱校准，并与两个 duplex 完成桥接验证。

主要依据：

- TaqMan Copy Number Assays User Guide, Pub. No. 4397425
- QuantStudio Design and Analysis Desktop Software User Guide, Pub. No. MAN0010408
- TaqMan Assay Multiplex PCR Optimization Application Guide, Pub. No. MAN0010189
