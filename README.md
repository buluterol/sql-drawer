# SQL CREATE TABLE Görselleştirici

Bu küçük araç, SQL `CREATE TABLE` sorgularını görselleştirerek tabloların ve ilişkilerinin bir diyagramını oluşturur. Kullanıcılar, SQL sorgularını bir metin kutusuna yapıştırarak tabloları ve yabancı anahtar ilişkilerini görsel olarak inceleyebilir.

## Özellikler

- **Tablo Görselleştirme**: SQL `CREATE TABLE` sorgularındaki tabloları kutular halinde gösterir.
- **Kolon Detayları**: Her tablo, kolon adlarını ve veri tiplerini içerir.
- **Yabancı Anahtar İlişkileri**: Tablolar arasındaki yabancı anahtar ilişkilerini çizgilerle gösterir.
- **Sürükle ve Bırak**: Tabloları diyagram üzerinde sürükleyerek düzenleyebilirsiniz.
- **Dinamik Bağlantılar**: Tablolar taşındığında bağlantılar otomatik olarak güncellenir.

## Kullanım

1. **SQL Sorgusunu Yapıştırın**: `CREATE TABLE` sorgunuzu metin kutusuna yapıştırın.
2. **Görselleştir Butonuna Tıklayın**: "Görselleştir" butonuna tıklayarak tabloları ve ilişkileri oluşturun.
3. **Diyagramı İnceleyin**: Tabloları sürükleyerek düzenleyebilir ve ilişkileri inceleyebilirsiniz.

## Örnek

Aşağıdaki SQL sorgusunu kullanarak bir diyagram oluşturabilirsiniz:

```sql
CREATE TABLE `product` (
   int(11) NOT NULL PRIMARY KEY AUTO_INCREMENT,
   varchar(255) NOT NULL,
  `created_by` int(11) DEFAULT NULL,
  CONSTRAINT `product_ibfk_1` FOREIGN KEY (`created_by`) REFERENCES `admin_user` ()
);
