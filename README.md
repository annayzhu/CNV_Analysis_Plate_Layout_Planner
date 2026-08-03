# TaqMan CNV Plate Planner

与 qPCR 板布局规划工具同系列的 TaqMan Copy Number Variation（CNV）技术人员工具。

## 功能

- 96/384 孔板；复孔默认从左到右连续排列，不跨行。
- 官方 duplex：每个 FAM target 分别与 VIC reference 同孔。
- 自建 multiplex：多个 target 与 reference 同孔，检查 reporter 是否重复。
- Calibrator、NTC、0/1/2-copy QC 自动在每块板重复。
- 默认 10.0 µL/孔反应体系，自动补水并按反应组计算 10% 配液余量。
- Excel 导出包含板图、孔明细、反应体系、Assay/Reporter 配置，以及与 `PCR-96-new.xlsx`、`PCR-384.xlsx` 一致的 `Well + Sample` 仪器粘贴列表。
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
