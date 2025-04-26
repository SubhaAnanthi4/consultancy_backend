const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();
const { MaterialDispatch, BatchReturn } = require('../model');
const ExcelJS = require('exceljs');
const cors = require('cors');
const path = require('path');
const PDFDocument = require('pdfkit');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch((err) => console.error('MongoDB connection error:', err));

//cd frontend
//  Welcome route
app.get('/', (req, res) => {
  res.send('Hello from backend!');
});

// Fetch all materials
app.get('/materials', async (req, res) => {
  try {
    const materials = await MaterialDispatch.find();
    res.json(materials);
  } catch (err) {
    console.error('Error fetching materials:', err);
    res.status(500).json({ message: 'Failed to fetch materials' });
  }
});


// In your Express backend
app.get('/api/wastage-summary', async (req, res) => {
  try {
    const dispatches = await MaterialDispatch.find();
    const summary = [];

    for (const dispatch of dispatches) {
      const batches = await BatchReturn.find({ materialId: dispatch._id });
      const totalReceived = batches.reduce((sum, batch) => sum + batch.receivedQuantity, 0);
      const wastage = ((dispatch.givenQuantity - totalReceived) / dispatch.givenQuantity) * 100;

      summary.push({
        productName: dispatch.materialName,
        wastageAmount: parseFloat(wastage.toFixed(2)),
      });
    }

    res.json(summary);
  } catch (error) {
    console.error('Error fetching wastage summary:', error);
    res.status(500).json({ message: 'Error fetching wastage summary' });
  }
});

// Add new material
app.post('/materials', async (req, res) => {
  try {
    const { materialName, toCompany, givenQuantity, dispatchDate } = req.body;
    const dispatch = new MaterialDispatch({
      materialName,
      toCompany,
      givenQuantity,
      dispatchDate
    });
    await dispatch.save();
    res.status(201).json({ message: "Material dispatched successfully", dispatch });
  } catch (error) {
    console.error("Error dispatching material:", error);
    res.status(500).json({ message: "Error dispatching material" });
  }
});

// Add batch return and recalculate wastage
app.post('/batch-return', async (req, res) => {
  try {
    const { materialId, receivedQuantity, receivedDate } = req.body;
    const batch = new BatchReturn({ materialId, receivedQuantity, receivedDate });
    await batch.save();
    await updateWastage(materialId);
    res.status(201).json({ message: 'Batch return saved successfully', batch });
  } catch (error) {
    console.error('Error saving batch return:', error);
    res.status(500).json({ message: 'Error saving batch return' });
  }
});

// Get wastage for a material
app.get('/wastage/:materialId', async (req, res) => {
  try {
    const { materialId } = req.params;
    const material = await MaterialDispatch.findById(materialId);
    if (!material) return res.status(404).json({ message: 'Material not found' });

    const batches = await BatchReturn.find({ materialId });
    const totalReceived = batches.reduce((acc, batch) => acc + batch.receivedQuantity, 0);
    const wastage = ((material.givenQuantity - totalReceived) / material.givenQuantity) * 100;

    res.status(200).json({
      materialName: material.materialName,
      toCompany: material.toCompany,
      givenQuantity: material.givenQuantity,
      totalReceived,
      wastagePercentage: wastage.toFixed(2),
    });
  } catch (error) {
    console.error('Error calculating wastage:', error);
    res.status(500).json({ message: 'Error calculating wastage' });
  }
});

// Get batch returns (optional filter)
app.get('/batch-returns/:materialId', async (req, res) => {
  try {
    const { materialId } = req.params;
    const { startDate, endDate } = req.query;

    const filter = { materialId };
    if (startDate && endDate) {
      filter.receivedDate = {
        $gte: new Date(startDate),
        $lte: new Date(endDate),
      };
    }

    const batches = await BatchReturn.find(filter);
    res.status(200).json(batches);
  } catch (error) {
    console.error("Error fetching batch returns:", error);
    res.status(500).json({ message: "Error fetching batch returns" });
  }
});

// ✅ UPDATED: Update a material and recalculate wastage
app.put('/materials/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { materialName, toCompany, givenQuantity, dispatchDate } = req.body;

    if (!materialName || !toCompany || !givenQuantity || !dispatchDate) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const material = await MaterialDispatch.findById(id);
    if (!material) {
      return res.status(404).json({ message: 'Material not found' });
    }

    material.materialName = materialName;
    material.toCompany = toCompany;
    material.givenQuantity = givenQuantity;
    material.dispatchDate = new Date(dispatchDate);

    await material.save();
    await updateWastage(id);

    res.status(200).json({ message: 'Material updated successfully', updatedMaterial: material });
  } catch (error) {
    console.error('Error updating material:', error);
    res.status(500).json({ message: 'Error updating material' });
  }
});

// ✅ Delete a material
app.delete('/materials/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await MaterialDispatch.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: 'Material not found' });
    }

    // Also optionally delete associated batch returns
    await BatchReturn.deleteMany({ materialId: id });

    res.status(200).json({ message: 'Material and associated batch returns deleted successfully' });
  } catch (error) {
    console.error('Error deleting material:', error);
    res.status(500).json({ message: 'Error deleting material' });
  }
});
// Export to Excel
app.get('/export/excel', async (req, res) => {
  try {
    const dispatches = await MaterialDispatch.find();

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Wastage Report');

    worksheet.columns = [
      { header: 'Material Name', key: 'materialName', width: 25 },
      { header: 'To Company', key: 'toCompany', width: 25 },
      { header: 'Given Quantity', key: 'givenQuantity', width: 15 },
      { header: 'Received Quantity', key: 'receivedQuantity', width: 18 },
      { header: 'Wastage (%)', key: 'wastage', width: 15 },
      { header: 'Dispatch Date', key: 'dispatchDate', width: 20 },
    ];

    for (const dispatch of dispatches) {
      const batches = await BatchReturn.find({ materialId: dispatch._id });
      const totalReceived = batches.reduce((sum, batch) => sum + batch.receivedQuantity, 0);
      const wastage = ((dispatch.givenQuantity - totalReceived) / dispatch.givenQuantity) * 100;

      worksheet.addRow({
        materialName: dispatch.materialName,
        toCompany: dispatch.toCompany,
        givenQuantity: dispatch.givenQuantity,
        receivedQuantity: totalReceived,
        wastage: wastage.toFixed(2),
        dispatchDate: dispatch.dispatchDate.toISOString().split('T')[0],
      });
    }

    const filePath = path.join(__dirname, 'wastage-report.xlsx');
    await workbook.xlsx.writeFile(filePath);

    res.download(filePath, 'wastage-report.xlsx', () => {
      fs.unlinkSync(filePath);
    });
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ message: 'Failed to export Excel report' });
  }
});

// Generate PDF Report
app.get('/generate-pdf/:id', async (req, res) => {
  try {
    const dispatch = await MaterialDispatch.findById(req.params.id);
    const batches = await BatchReturn.find({ materialId: req.params.id });

    if (!dispatch) {
      return res.status(404).json({ message: 'Material not found' });
    }

    const totalReceived = batches.reduce((sum, b) => sum + b.receivedQuantity, 0);
    const wastage = ((dispatch.givenQuantity - totalReceived) / dispatch.givenQuantity) * 100;

    const doc = new PDFDocument();
    const filename = `report_${dispatch.materialName}_${Date.now()}.pdf`;
    const filePath = `./reports/${filename}`;

    if (!fs.existsSync('./reports')) fs.mkdirSync('./reports');

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(20).text('Material Dispatch Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(14).text(`Material: ${dispatch.materialName}`);
    doc.text(`Company: ${dispatch.toCompany}`);
    doc.text(`Dispatched Quantity: ${dispatch.givenQuantity}`);
    doc.text(`Dispatch Date: ${new Date(dispatch.dispatchDate).toLocaleDateString()}`);
    doc.moveDown();

    doc.fontSize(16).text('Batch Returns:', { underline: true });
    batches.forEach((batch, index) => {
      doc.fontSize(12).text(`${index + 1}. Received: ${batch.receivedQuantity} on ${new Date(batch.receivedDate).toLocaleDateString()}`);
    });

    doc.moveDown();
    doc.fontSize(14).text(`Total Received: ${totalReceived}`);
    doc.text(`Wastage: ${wastage.toFixed(2)}%`);

    doc.end();

    stream.on('finish', () => {
      res.download(filePath, filename);
    });
  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ message: 'Error generating PDF' });
  }
});

// ✅ Utility to recalculate wastage
async function updateWastage(materialId) {
  const batches = await BatchReturn.find({ materialId });
  const totalReceived = batches.reduce((acc, batch) => acc + batch.receivedQuantity, 0);
  const material = await MaterialDispatch.findById(materialId);

  if (!material || !material.givenQuantity) return;

  const wastage = ((material.givenQuantity - totalReceived) / material.givenQuantity) * 100;
  material.wastage = wastage.toFixed(2);
  await material.save();
}

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
